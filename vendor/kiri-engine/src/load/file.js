/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */
/** Trimmed for FDM slicing: STL only */

'use strict';

import { STL } from './stl.js';

const types = {
    stl(data, file, resolve, reject, opt = {}) {
        resolve([{
            mesh: new STL().parse(data), file
        }]);
    },
};

const as_buffer = [ "stl" ];

function load_data(data, file, ext, opt = {}) {
    ext = ext || file.name.toLowerCase().split('.').pop();
    return new Promise((resolve, reject) => {
        let fn = types[ext];
        if (fn) {
            fn(data, file, resolve, reject, opt);
        } else {
            reject(`unknown file type: "${ext}" from ${file}`);
        }
    });
}

function load_file(file, opt) {
    if (Array.isArray(file)) {
        return Promise.all(file.map(file => load_file(file, opt)));
    }
    return new Promise((resolve, reject) => {
        if (!file) {
            return reject('invalid or missing file');
        }
        let reader = new FileReader();
        let name = file.name;
        let ext = name.toLowerCase().split('.').pop();
        reader.file = file;
        reader.onloadend = function (event) {
            load_data(event.target.result, name, ext, opt)
                .then(data => resolve(data))
                .catch(e => reject(e));
        };
        if (as_buffer.indexOf(ext) >= 0) {
            reader.readAsArrayBuffer(reader.file);
        } else {
            reader.readAsBinaryString(reader.file);
        }
    });
}

Object.assign(load_file, { STL });

export { types, as_buffer, load_data, load_file, load_file as load };
