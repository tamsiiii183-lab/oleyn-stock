// White card with a Cloud border and 12 px corners (spec 11.2).
export default function Card({ className = '', children, ...props }) {
  return (
    <div className={`rounded-xl border border-cloud bg-white p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}
