// Buttons from spec 11.3: primary (Oleyn Blue, full width, 48 px) and secondary (white with blue border).
export default function Button({ variant = 'primary', className = '', ...props }) {
  const base = 'min-h-[48px] w-full rounded-xl px-4 font-semibold transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-brand-light';
  const styles = {
    primary: 'bg-brand text-white active:bg-brand-dark',
    secondary: 'border-2 border-brand bg-white text-brand',
    ghost: 'bg-transparent text-brand underline',
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}
