import { Menu, Compass, BookOpen, GraduationCap, LogOut, Home, User } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export function MobileMenu({ onSignOut, displayName }: { onSignOut: () => void; displayName: string }) {
  const items = [
    { to: "/dashboard", label: "Dashboard", icon: Home },
    { to: "/browse", label: "Browse courses", icon: Compass },
    { to: "/learn", label: "My learning", icon: BookOpen },
    { to: "/studio", label: "Instructor studio", icon: GraduationCap },
  ] as const;
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button title="Menu" aria-label="Menu"><Menu className="h-5 w-5" /></button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-4 w-4" /> {displayName}
          </SheetTitle>
        </SheetHeader>
        <nav className="mt-6 flex flex-col gap-1">
          {items.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-secondary"
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
          <button
            onClick={onSignOut}
            className="mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive hover:bg-secondary"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
