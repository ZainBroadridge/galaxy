export default function ResourceSkeleton({ label = 'Loading', rows = 3 }) {
  return <div className="portal-skeleton" role="status" aria-label={label} aria-busy="true">
    {Array.from({ length: rows }, (_, index) => <div className="portal-skeleton-row" key={index} aria-hidden="true"><span /><span /></div>)}
  </div>;
}
