function Icon({ children, className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function EditIcon() { return <Icon><path d="m4 13.5-.5 3 3-.5L16 6.5 13.5 4 4 13.5Z" /><path d="m11.5 6 2.5 2.5" /></Icon>; }
export function ChevronRightIcon() { return <Icon><path d="m8 5 5 5-5 5" /></Icon>; }
export function ChevronLeftIcon() { return <Icon><path d="m12 5-5 5 5 5" /></Icon>; }
export function ChevronDownIcon() { return <Icon><path d="m5 8 5 5 5-5" /></Icon>; }
export function ExternalLinkIcon() { return <Icon><path d="M5 15 15 5M8 5h7v7" /></Icon>; }
