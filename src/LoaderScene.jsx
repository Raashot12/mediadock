import { useEffect, useRef } from "react";
import * as THREE from "three";

const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    float bands = sin(vPosition.y * 8.0 + sin(vPosition.x * 5.0 + uTime * 0.8) + uTime * 1.6) * 0.5 + 0.5;
    float rim = pow(1.0 - abs(normalize(vNormal).z), 2.2);
    vec3 forest = vec3(0.07, 0.22, 0.18);
    vec3 leaf = vec3(0.22, 0.52, 0.37);
    vec3 gold = vec3(0.89, 0.68, 0.30);
    vec3 color = mix(forest, leaf, smoothstep(0.08, 0.92, bands) * 0.82);
    color = mix(color, gold, rim * 0.48);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export default function LoaderScene() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const fallback = canvas.nextElementSibling;
    fallback?.removeAttribute("hidden");
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return undefined;
    }
    fallback?.setAttribute("hidden", "");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 20);
    camera.position.z = 4.4;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.setClearColor(0x000000, 0);

    const sphereMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader,
      fragmentShader,
      toneMapped: false,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.82, 64, 48), sphereMaterial);
    scene.add(core);

    const orbitOne = new THREE.Mesh(
      new THREE.TorusGeometry(1.08, 0.012, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0x7da28b, transparent: true, opacity: 0.72 }),
    );
    orbitOne.rotation.set(0.72, 0.2, -0.2);
    scene.add(orbitOne);

    const orbitTwo = new THREE.Mesh(
      new THREE.TorusGeometry(1.22, 0.006, 8, 144),
      new THREE.MeshBasicMaterial({ color: 0xe2b24d, transparent: true, opacity: 0.8 }),
    );
    orbitTwo.rotation.set(-0.92, 0.52, 0.34);
    scene.add(orbitTwo);

    const playShape = new THREE.Shape();
    playShape.moveTo(-0.17, -0.24);
    playShape.lineTo(-0.17, 0.24);
    playShape.lineTo(0.26, 0);
    playShape.closePath();
    const playMark = new THREE.Mesh(
      new THREE.ShapeGeometry(playShape),
      new THREE.MeshBasicMaterial({ color: 0xf0cf79, side: THREE.DoubleSide, toneMapped: false }),
    );
    playMark.position.set(0.03, 0, 0.81);
    scene.add(playMark);

    const satellite = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 18, 16),
      new THREE.MeshBasicMaterial({ color: 0xf0cf79, toneMapped: false }),
    );
    scene.add(satellite);

    function resize() {
      const bounds = canvas.parentElement?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    const start = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function render(now = start) {
      const time = (now - start) / 1000;
      if (!reducedMotion) {
        sphereMaterial.uniforms.uTime.value = time;
        core.rotation.y = time * 0.16;
        core.rotation.x = Math.sin(time * 0.32) * 0.055;
        orbitOne.rotation.z = -0.2 + time * 0.19;
        orbitTwo.rotation.y = 0.52 - time * 0.14;
        satellite.position.set(Math.cos(time * 1.1) * 1.08, Math.sin(time * 1.1) * 0.45, Math.sin(time * 1.1) * 0.86);
      }
      renderer.render(scene, camera);
      if (!reducedMotion) frame = window.requestAnimationFrame(render);
    }
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
        else object.material.dispose();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div className="loader-scene">
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="loader-scene-fallback" aria-hidden="true" />
    </div>
  );
}
