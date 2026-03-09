/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */
/** Trimmed for FDM-only slicing */

import '../../add/array.js';
import '../../add/class.js';
import '../../add/three.js';

import { base } from '../../geo/base.js';
import { codec } from '../core/codec.js';
import { newPoint } from '../../geo/point.js';
import { newPrint } from '../core/print.js';
import { polygons as POLY } from '../../geo/polygons.js';
import { render } from '../core/render.js';
import { util } from '../../geo/base.js';
import { version } from '../../moto/license.js';
import { wasm_ctrl } from '../../geo/wasm.js';
import { Widget, newWidget } from '../core/widget.js';

import { FDM } from '../mode/fdm/work/init-work.js';

const { time } = util;
const POOLPATH = "./minion.js";

let drivers = {
        FDM,
    },
    ccvalue = self.navigator ? self.navigator.hardwareConcurrency || 0 : 0,
    concurrent = Math.min(4, self.Worker && ccvalue > 3 ? ccvalue - 1 : 0),
    current = {
        print: null,
        snap: null,
        mode: null,
    },
    wgroup = {},
    wcache = {},
    pcache = {},
    minions = [],
    minionq = [],
    minifns = {},
    miniseq = 0;

function debug() {
    if (self.debug === true)
    console.log(...arguments);
}

function setPrint(print) {
    if (current.print && current.print !== print) {
        current.print.disposeSafeEval();
    }
    return current.print = print;
}

// catch clipper alerts and convert to console messages
self.alert = function(o) {
    console.log(o);
};

self.uuid = ((Math.random() * Date.now()) | 0).toString(36);

function minhandler(msg) {
    let data = msg.data;
    let seq = data.seq;
    let fn = minifns[seq];
    if (!fn) {
        throw `missing dispatch ${seq}`;
    }
    delete minifns[seq];
    fn(data);
}

// for concurrent operations
const minwork = {
    get concurrent() {
        return concurrent
    },

    get running() {
        return minions.length;
    },

    start(poolpath) {
        if (minions.length || !concurrent) {
            return;
        }
        for (let i=0; i < concurrent; i++) {
            let minion = new Worker(poolpath || POOLPATH, { type: 'module' });
            minion.onerror = (error) => {
                debug({ MINION_ERROR: error });
                error.preventDefault();
            };
            minion.onmessageerror = (error) => {
                debug({ MINION_MESSAGE_ERROR: error });
                error.preventDefault();
            };
            minion.onmessage = minhandler;
            minion.postMessage({ cmd: "label", name: `#${i}` });
            minions.push(minion);
        }
        console.log(`kiri | init pool | ${version || "rogue"} | ${concurrent}`);
    },

    stop() {
        for (let minion of minions) {
            minion.terminate();
        }
        minions.length = 0;
    },

    union(polys, minarea) {
        return new Promise((resolve, reject) => {
            if (concurrent < 2 || polys.length < concurrent * 2 || POLY.points(polys) < concurrent * 50) {
                resolve(POLY.union(polys, minarea, true));
                return;
            }
            let polyper = Math.ceil(polys.length / concurrent);
            let running = 0;
            let union = [];
            let receiver = function(data) {
                let polys = codec.decode(data.union);
                union.appendAll(polys);
                if (--running === 0) {
                    resolve(POLY.union(union, minarea, true));
                }
            };
            for (let i=0; i<polys.length; i += polyper) {
                let state = { zeros: [] };
                running++;
                minwork.queue({
                    cmd: "union",
                    minarea,
                    polys: codec.encode(polys.slice(i, i + polyper), state)
                }, receiver, state.zeros);
            }
        });
    },

    fill(polys, angle, spacing, output, minLen, maxLen) {
        return new Promise((resolve, reject) => {
            if (concurrent < 2) {
                resolve(POLY.fillArea(polys, angle, spacing, [], minLen, maxLen));
                return;
            }
            const state = { zeros: [] };
            minwork.queue({
                cmd: "fill",
                polys: codec.encode(polys, state),
                angle, spacing, minLen, maxLen
            }, data => {
                let arr = data.fill;
                let fill = [];
                for (let i=0; i<arr.length; ) {
                    let pt = newPoint(arr[i++], arr[i++], arr[i++]);
                    pt.index = arr[i++];
                    fill.push(pt);
                }
                output.appendAll(fill);
                resolve(fill);
            }, state.zeros);
        });
    },

    clip(slice, polys, lines) {
        return new Promise((resolve, reject) => {
            if (concurrent < 2) {
                reject("concurrent clip unavailable");
            }
            const state = { zeros: [] };

            minwork.queue({
                cmd: "clip",
                polys: codec.encode(POLY.flatten(polys).map(poly => codec.encodePointArray2D(poly.points, state)), state),
                lines: codec.encode(lines.map(array => codec.encodePointArray2D(array, state)), state),
                z: slice.z
            }, data => {
                let polys = codec.decode(data.clips);
                for (let top of slice.tops) {
                    for (let poly of polys) {
                        if (poly.isInside(top.poly)) {
                            top.fill_sparse.push(poly);
                        }
                    }
                }
                resolve(polys);
            }, state.zeros);
        });
    },

    sliceZ(z, points, options) {
        return new Promise((resolve, reject) => {
            if (concurrent < 2) {
                reject("concurrent slice unavaiable");
            }
            let { each } = options;
            let i = 0, floatP = new Float32Array(points.length * 3);
            for (let p of points) {
                floatP[i++] = p.x;
                floatP[i++] = p.y;
                floatP[i++] = p.z;
            }
            minwork.queue({
                cmd: "sliceZ",
                z,
                points: floatP,
                options: codec.toCodable(options)
            }, data => {
                let recs = codec.decode(data.output);
                if (each) {
                    for (let rec of recs) {
                        each(rec);
                    }
                }
                resolve(recs);
            }, [ floatP.buffer ]);
        });
    },

    queue(work, ondone, direct) {
        minionq.push({work, ondone, direct});
        minwork.kick();
    },

    queueAsync(work, direct) {
        return new Promise(resolve => {
            minwork.queue(work, resolve, direct);
        });
    },

    kick() {
        if (minions.length && minionq.length) {
            let qrec = minionq.shift();
            let minion = minions.shift();
            let seq = miniseq++;
            qrec.work.seq = seq;
            minifns[seq] = (data) => {
                qrec.ondone(data);
                minions.push(minion);
                minwork.kick();
            };
            minion.postMessage(qrec.work, qrec.direct);
        }
    },

    broadcast(cmd, data, direct) {
        for (let minion of minions) {
            minion.postMessage({
                cmd, ...data
            }, direct);
        }
    }
};

console.log(`kiri | init work | ${version || "rogue"}`);

// code is running in the worker / server context
const dispatch = {
    pool_start(data, send) {
        minwork.start(data.url);
        send.done({});
    },

    pool_stop(data, send) {
        minwork.stop();
        send.done({});
    },

    group: wgroup,

    cache: wcache,

    // purge all sync data
    clear(data, send) {
        setPrint(null);
        dispatch.group = wgroup = {};
        dispatch.cache = worker.cache = wcache = {};
        Widget.Groups.clear();
        send.done({ clear: true });
    },

    // widget sync
    sync(data, send) {
        let group = wgroup[data.group];
        if (!group) {
            group = [];
            group.id = data.group;
            wgroup[data.group] = group;
        }

        let vertices = data.vertices,
            widget = newWidget(data.id, group)
                .setInWorker()
                .loadVertices(vertices);

        wcache[data.id] = widget;
        widget.vertices = vertices;
        widget.meta = data.meta;
        widget.anno = data.anno;
        widget.track = data.track;
        console.log('[kiri-dbg] sync widget', {
            id: data.id,
            vertexCount: vertices?.length,
            anno: data.anno,
            group: data.group,
            bounds: widget.getBoundingBox?.(),
        });
        send.done(data.id);
    },

    // belt mode rotate widgets 45 degrees on X axis before slicing
    rotate(data, send) {
        let { settings } = data;
        if (!settings.device.bedBelt) {
            return send.done({});
        }

        function mins(vert, last = {}) {
            let miny = last.miny || Infinity,
                maxy = last.maxy || -Infinity;
            for (let i=0, l=vert.length; i<l; ) {
                let x = vert[i++];
                let y = vert[i++];
                let z = vert[i++];
                miny = Math.min(miny, y);
                maxy = Math.max(maxy, y);
            }
            return { miny, maxy };
        }

        function gmin(group) {
            let minv = {};
            for (let w of group) {
                minv = mins(w.vertices, minv);
            }
            return minv;
        }

        for (let group of Object.values(wgroup)) {
            let { miny, maxy } = gmin(group);
            let widget = group[0];
            let proc = settings.process;
            let track = widget.track;
            let angle = proc.sliceAngle;
            let xpos = track.pos.x;
            let yoff = proc.beltAnchor || proc.firstLayerBeltLead || 0;
            let ypos = settings.device.bedDepth / 2 + track.pos.y + miny + yoff;
            let radians = Math.PI / 180;
            let rotation = radians * angle;
            for (let w of group) {
                w.moveMesh(0, miny, 0);
            }
            widget.rotate(rotation, 0, 0, true, false);
            widget.belt = {
                angle,
                xpos,
                ypos,
                dy: - miny - yoff,
                dz: 0,
                cosf: Math.cos(radians * angle),
                sinf: Math.sin(radians * angle),
                slope: Math.tan(radians * (90 - angle))
            };
            for (let others of group.slice(1)) {
                others.belt = widget.belt;
            }
            send.data({group: group.id, belt: widget.belt});
        }
        send.done({});
    },

    slicePre(data, send) {
        const { settings } = data;
        const { mode } = settings;
        const driver = drivers[mode];

        if (driver.slicePre) {
            driver.slicePre(settings);
        }

        send.done();
    },

    slice(data, send) {
        console.log('[kiri-dbg] slice start', { id: data.id, hasWidget: !!wcache[data.id] });
        send.data({ update:0.001, updateStatus:"slicing" });

        const { settings } = data;
        const { mode } = settings;
        const driver = drivers[mode];
        const widget = wcache[data.id];

        console.log('[kiri-dbg] slice settings', {
            mode,
            hasDriver: !!driver,
            hasWidget: !!widget,
            sliceHeight: settings.process?.sliceHeight,
            extruders: settings.device?.extruders?.length,
            bedSize: [settings.device?.bedWidth, settings.device?.bedDepth],
        });

        if (!widget) {
            console.error('[kiri-dbg] widget not found in cache', { id: data.id, cacheKeys: Object.keys(wcache) });
            send.data({error: "widget not found in worker cache"});
            send.done({done: true});
            return;
        }

        if (!(driver && driver.prepare)) {
            console.error('[kiri-dbg] invalid driver', { mode, driver });
            send.data({error: `invalid print driver: ${mode}`});
            send.done({done: true});
            return;
        }

        let last = time(), now;

        setPrint(null);
        current.mode = settings.mode.toUpperCase();

        widget.settings = settings;
        widget.clearSlices();

        console.log('[kiri-dbg] calling driver.slice', {
            points: widget.getPoints?.()?.length,
            bounds: widget.getBoundingBox?.(),
        });

        driver.slice(settings, widget, (update, msg, alert) => {
            now = time();
            if (alert) send.data({ alert });
            if (now - last < 10 && update < 0.99) return;
            if (update || msg) send.data({update: (0.05 + update * 0.95), updateStatus: msg});
            last = now;
        }, (error) => {
            console.log('[kiri-dbg] slice ondone', { error, sliceCount: widget.slices?.length });
            if (error) {
                send.data({error: error});
            } else {
                const slices = widget.slices || [];
                send.data({send_start: time()});
                send.data({
                    stats: widget.stats,
                    slices: slices.length,
                });
                slices.forEach((slice,index) => {
                    const state = { zeros: [] };
                    send.data({index: index, slice: slice.encode(state)}, state.zeros);
                })
                send.data({send_end: time()});
            }
            send.done({done: true});
            widget.points = undefined;
        });
    },

    slicePost(data, send) {
        const { settings } = data;
        const { mode } = settings;
        const driver = drivers[mode];

        if (driver.slicePost) {
            driver.slicePost(settings, send.data);
        }

        send.done({done: true});
    },

    prepare(data, send) {
        const widgets = Object.values(wcache);

        send.data({update:0.05, updateStatus:"preview"});

        const { settings } = data;
        const { mode } = settings;
        const driver = drivers[mode];

        if (!(driver && driver.prepare)) {
            return console.log({ invalid_print_driver: mode, driver });
        }

        driver.prepare(widgets, settings, (progress, message, layer) => {
            const state = { zeros: [] };
            const emit = { progress, message, layer: (layer ? layer.encode(state) : undefined) };
            send.data(emit, state.zeros);
        }).then(() => {
            const unitScale = settings.controller.units === 'in' ? (1 / 25.4) : 1;
            const print = setPrint(current.print || {});
            const minSpeed = (print.minSpeed || 0) * unitScale;
            const maxSpeed = (print.maxSpeed || 0) * unitScale;

            send.data({ progress: 1, message: "transfer" });
            send.done({ done: true, minSpeed, maxSpeed });
        });
    },

    export(data, send) {
        const mode = data.settings.mode;
        const driver = drivers[mode];

        if (!(driver && driver.export)) {
            console.log({missing_export_driver: mode});
            return send.done()
        }

        let output;
        driver.export(current.print, (line, direct) => {
            send.data({line}, direct);
        }, (done) => {
            output = done;
        }, (debug) => {
            send.data({debug});
        });

        const {
            bounds,
            time,
            lines,
            bytes,
            distance,
            settings,
            segments,
            purges,
            labels
        } = current.print;

        send.done({
            done: true,
            output: output ? output : {
                bounds,
                time,
                lines,
                bytes,
                distance,
                settings,
                segments,
                purges,
                labels
            }
        });
    },

    colors(data, send) {
        const { colors, max } = data;
        const colorMap = {};
        colors.forEach(color => {
            colorMap[color] = render.rate_to_color(color, max);
        });
        send.done(colorMap);
    },

    config(data, send) {
        const update = {};
        if (data.base) {
            update.base = data.base;
            Object.assign(base.config, data.base);
        } else {
            console.log({invalid:data});
        }
        for (let minion of minions) {
            minion.postMessage({
                cmd: "config",
                base: data.base
            });
        }
        send.done({config: update});
    },

    wasm(data, send) {
        if (data.enable) {
            wasm_ctrl.enable();
        } else {
            wasm_ctrl.disable();
        }
        minwork.broadcast("wasm", { enable: data.enable ? true : false });
        send.done({ wasm: data });
    },

    putCache(msg, send) {
        const { key, data } = msg;
        if (data) {
            pcache[key] = data;
        } else {
            delete pcache[key];
        }
        minwork.broadcast("putCache", msg);
        send.done({ ok: true });
    },

    clearCache(msg, send) {
        pcache = {};
        minwork.broadcast("clearCache", msg);
        send.done({ ok: true });
    }
};

function is_async(fn) {
    return fn.constructor.name === "AsyncFunction";
}

dispatch.send = (msg, direct) => {
    self.postMessage(msg, direct);
};

dispatch.onmessage = self.onmessage = async function(e) {
    let time_recv = time(),
        msg = e.data || {},
        run = dispatch[msg.task],
        send = {
            data : function(data, direct) {
                dispatch.send({
                    seq: msg.seq,
                    task: msg.task,
                    done: false,
                    data: data
                }, direct);
            },
            done : function(data,direct) {
                dispatch.send({
                    seq: msg.seq,
                    task: msg.task,
                    done: true,
                    data: data
                }, direct);
            }
        };

    console.log(`[kiri-worker] recv task="${msg.task}" seq=${msg.seq}`);

    if (run) {
        try {
            let time_xfer = (time_recv - msg.time),
                output = is_async(run) ? await run(msg.data, send) : run(msg.data, send),
                time_send = time(),
                time_proc = time_send - time_recv;

            console.log(`[kiri-worker] done task="${msg.task}" seq=${msg.seq} time=${time_proc}ms`);

            if (output) dispatch.send({
                seq: msg.seq,
                task: msg.task,
                time_send: time_xfer,
                time_proc: time_proc,
                time_recv: time(),
                data: output
            });
        } catch (wrkerr) {
            console.error(`[kiri-worker] ERROR task="${msg.task}"`, wrkerr);
            console.trace(wrkerr.stack);
            send.done({error: wrkerr.toString()});
        }
    } else {
        console.log({worker_unhandled: e, msg, fn: dispatch[msg.task]});
    }
};

const worker = self.kiri_worker = {
    cache: wcache,
    current,
    dispatch,
    drivers,
    version,
    minions: minwork
};

// initialize FDM driver
for (let driver of Object.values(drivers)) {
    driver.init(worker);
}
