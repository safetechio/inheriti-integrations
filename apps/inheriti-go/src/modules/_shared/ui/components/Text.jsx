// Business typography variants used by the Tray, rendered as native HTML.
export function Text({ as: Element = 'span', variant = 'regular', className = '', children, ...props }) {
  return <Element className={`text-${variant}${className ? ` ${className}` : ''}`} {...props}>{children}</Element>;
}
