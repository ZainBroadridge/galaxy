import { useEffect, useRef } from 'react';

/** Decorative only: no input interception, network access or application state. */
export default function ParticleBackground() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const nodes = Array.from({ length: 36 }, (_value, index) => ({
      x: ((index * 37 + 13) % 101) / 101, y: ((index * 61 + 7) % 97) / 97,
      vx: ((index % 3) - 1) * 0.000012, vy: ((index % 5) - 2) * 0.000008,
      radius: 2 + index % 3, accent: index % 11 === 0,
    }));
    let frame = 0;
    let width = 1;
    let height = 1;
    let previous = 0;
    let disposed = false;
    function draw(time = 0) {
      if (disposed) return;
      const elapsed = motion.matches ? 0 : Math.min(40, time - previous || 0);
      previous = time;
      context.clearRect(0, 0, width, height);
      for (const node of nodes) {
        node.x += node.vx * elapsed; node.y += node.vy * elapsed;
        if (node.x < 0 || node.x > 1) node.vx *= -1;
        if (node.y < 0 || node.y > 1) node.vy *= -1;
        node.x = Math.max(0, Math.min(1, node.x)); node.y = Math.max(0, Math.min(1, node.y));
      }
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        for (const other of nodes.slice(index + 1)) {
          const gap = Math.hypot((node.x - other.x) * width, (node.y - other.y) * height);
          if (gap > 210) continue;
          context.strokeStyle = `rgba(29,84,146,${(1 - gap / 210) * 0.22})`;
          context.lineWidth = 1; context.beginPath();
          context.moveTo(node.x * width, node.y * height); context.lineTo(other.x * width, other.y * height); context.stroke();
        }
        context.fillStyle = node.accent ? '#ec8b44' : '#2d659f';
        context.shadowColor = node.accent ? '#ec8b44' : '#769dca'; context.shadowBlur = 12;
        context.beginPath(); context.arc(node.x * width, node.y * height, node.radius, 0, Math.PI * 2); context.fill();
        context.shadowBlur = 0;
      }
      if (!motion.matches && !document.hidden) frame = window.requestAnimationFrame(draw);
    }
    function restart() {
      window.cancelAnimationFrame(frame); previous = 0;
      if (!document.hidden) draw();
    }
    function resize() {
      const bounds = canvas.getBoundingClientRect(); width = bounds.width; height = bounds.height;
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0); restart();
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas);
    motion.addEventListener('change', restart); document.addEventListener('visibilitychange', restart);
    resize();
    return () => {
      disposed = true; window.cancelAnimationFrame(frame); observer.disconnect();
      motion.removeEventListener('change', restart); document.removeEventListener('visibilitychange', restart);
    };
  }, []);
  return <canvas ref={canvasRef} className="issuer-particles" aria-hidden="true" />;
}
