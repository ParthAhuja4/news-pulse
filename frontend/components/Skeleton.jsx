// Placeholder block shown while content loads.
export default function Skeleton({ className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-md bg-surface-2 motion-safe:animate-pulse ${className}`}
    />
  );
}
