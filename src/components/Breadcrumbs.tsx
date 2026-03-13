import { Link } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4 flex-wrap">
      <Link
        to="/home"
        className="flex items-center gap-1 hover:text-primary transition-colors shrink-0"
      >
        <Home className="h-3.5 w-3.5" />
        <span className="font-heading">Home</span>
      </Link>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            <ChevronRight className="h-3 w-3 shrink-0" />
            {isLast || !item.href ? (
              <span className="font-heading font-semibold text-foreground">{item.label}</span>
            ) : (
              <Link to={item.href} className="font-heading hover:text-primary transition-colors">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
