// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Add inverted-color edge lines to a mesh for visibility on dark surfaces */
function addEdgeLines(mesh: THREE.Mesh, faceColor: THREE.Color) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 30);
  const inverted = new THREE.Color(1 - faceColor.r, 1 - faceColor.g, 1 - faceColor.b);
  const lineMat = new THREE.LineBasicMaterial({ color: inverted, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(edges, lineMat);
  mesh.add(lines);
}

interface PreviewPanelProps {
  /** Raw ArrayBuffer of STL or 3MF data, or null when nothing has been rendered yet. */
  modelData: ArrayBuffer | null;
  /** The format of the model data. */
  modelFormat: '3mf' | 'stl' | null;
}

export function PreviewPanel({ modelData, modelFormat }: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);
  const [error, setError] = useState<string | null>(null);

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    camera.position.set(100, 100, 100);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x666666);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(directionalLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
    backLight.position.set(-1, -0.5, -1).normalize();
    scene.add(backLight);

    // Grid helper
    const grid = new THREE.GridHelper(200, 20, 0xcccccc, 0xe0e0e0);
    scene.add(grid);

    // Animation loop
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load model when data changes
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    // Remove previous model
    if (modelGroupRef.current) {
      scene.remove(modelGroupRef.current);
      modelGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      modelGroupRef.current = null;
    }

    if (!modelData || !modelFormat) {
      setError(null);
      return;
    }

    try {
      let group: THREE.Group;

      if (modelFormat === 'stl') {
        const loader = new STLLoader();
        const geometry = loader.parse(modelData);
        const material = new THREE.MeshPhongMaterial({
          color: 0x4a90d9,
          specular: 0x222222,
          shininess: 40,
        });
        const mesh = new THREE.Mesh(geometry, material);
        group = new THREE.Group();
        group.add(mesh);
        addEdgeLines(mesh, material.color);
      } else {
        const loader = new ThreeMFLoader();
        group = loader.parse(modelData) as THREE.Group;
        // Apply default material to meshes that lack one;
        // leave colored meshes (vertexColors) untouched.
        group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshPhongMaterial;
            if (!mat) {
              child.material = new THREE.MeshPhongMaterial({
                color: 0x4a90d9,
                specular: 0x222222,
                shininess: 40,
              });
              addEdgeLines(child, new THREE.Color(0x4a90d9));
            } else if (mat.vertexColors) {
              // Colorgroup-based mesh — vertex colors encode the actual color.
              // Add specular + shininess for better visibility, especially for
              // white/light colors that otherwise blend into the background.
              mat.specular = new THREE.Color(0x222222);
              mat.shininess = 40;
              addEdgeLines(child, mat.color || new THREE.Color(0x808080));
            } else if (mat.name === THREE.Loader.DEFAULT_MATERIAL_NAME) {
              // Default white material from loader (no colorgroup) — replace with a nicer color
              mat.color.setHex(0x4a90d9);
              mat.specular = new THREE.Color(0x222222);
              mat.shininess = 40;
              addEdgeLines(child, mat.color);
            } else {
              addEdgeLines(child, mat.color || new THREE.Color(0x808080));
            }
          }
        });
      }

      // OpenSCAD uses Z-up; Three.js uses Y-up — rotate to lay flat
      group.rotation.x = -Math.PI / 2;

      // Compute bounding box after rotation
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      // Center horizontally, place bottom on the grid plane (y=0)
      group.position.set(-center.x, -box.min.y, -center.z);
      modelGroupRef.current = group;
      scene.add(group);

      // Position camera to see the whole model
      const fitDistance = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
      camera.position.set(fitDistance * 1.2, fitDistance * 0.8, fitDistance * 1.2);
      camera.near = maxDim * 0.001;
      camera.far = maxDim * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
    }
  }, [modelData, modelFormat]);

  const hasModel = !!modelData;

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <h3>Preview</h3>
      </div>
      {error && <div className="preview-error">{error}</div>}
      {!hasModel && (
        <div className="preview-placeholder">
          Generate 3MF or STL to preview
        </div>
      )}
      <div
        className="preview-3d-container"
        ref={containerRef}
        style={{ display: hasModel ? 'block' : 'none' }}
      />
    </div>
  );
}
