function Icon({ children, className }) {
  return <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function EditIcon() { return <Icon><path d="m4 13.5-.5 3 3-.5L16 6.5 13.5 4 4 13.5Z" /><path d="m11.5 6 2.5 2.5" /></Icon>; }
export function ChevronRightIcon() { return <Icon><path d="m8 5 5 5-5 5" /></Icon>; }
export function ChevronLeftIcon() { return <Icon><path d="m12 5-5 5 5 5" /></Icon>; }
export function ChevronDownIcon() { return <Icon><path d="m5 8 5 5 5-5" /></Icon>; }
export function ExternalLinkIcon() { return <Icon><path d="M5 15 15 5M8 5h7v7" /></Icon>; }
export function LockIcon() { return <Icon><rect x="4.5" y="9" width="11" height="8" rx="2" /><path d="M7 9V6.5a3 3 0 0 1 6 0V9" /></Icon>; }
export function PlanIcon() { return <Icon><rect x="4" y="3" width="12" height="14" rx="1" /><path d="M7 7h6M7 10h6M7 13h4" /></Icon>; }
export function PlusIcon() { return <Icon><path d="M10 4v12M4 10h12" /></Icon>; }
