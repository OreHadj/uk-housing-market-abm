import { useId } from 'react';
import type { GuidedTourRectangle } from '../lib/guidedTourGeometry';

/** One shade keeps overlapping and additional interactive targets equally clear. */
export function DemoShading({ holes }: { holes: readonly GuidedTourRectangle[] }) {
  const id = useId().replace(/:/g, '');
  const maskId = `demo-shading-mask-${id}`;
  const blurId = `demo-shading-blur-${id}`;
  return <svg
    className="demo-shading"
    aria-hidden="true"
    focusable="false"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
  >
    <defs>
      <filter id={blurId} x="-100%" y="-100%" width="300%" height="300%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="6" />
      </filter>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%" style={{ maskType: 'luminance' }}>
        <rect width="100%" height="100%" fill="white" />
        <g filter={`url(#${blurId})`} fill="black">
          {holes.map((hole, index) => <rect
            key={index}
            x={hole.left} y={hole.top} width={hole.width} height={hole.height}
            rx="20" ry="20"
          />)}
        </g>
      </mask>
    </defs>
    <rect width="100%" height="100%" fill="rgba(10, 24, 17, 0.66)" mask={`url(#${maskId})`} />
  </svg>;
}
