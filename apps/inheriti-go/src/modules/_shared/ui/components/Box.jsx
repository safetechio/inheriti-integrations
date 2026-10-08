// Local DOM counterpart of Business UI's Box for the Tray renderer.
export function Box({ as: Element = 'div', className = '', children, ...props }) {
  return <Element className={className} {...props}>{children}</Element>;
}
