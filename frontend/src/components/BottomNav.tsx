import { Link, useLocation } from "react-router-dom";
import { Dumbbell, UtensilsCrossed, ScanLine, Home } from "lucide-react";

const BottomNav = () => {
  const location = useLocation();
  const path = location.pathname;

  const links = [
    { to: "/", icon: Home, label: "Home" },
    { to: "/workouts", icon: Dumbbell, label: "Workouts" },
    { to: "/recipes", icon: UtensilsCrossed, label: "Recipes" },
    { to: "/scan", icon: ScanLine, label: "Scan" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {links.map((link) => {
          const isActive = path === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`flex flex-col items-center gap-1 px-4 py-2 transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <link.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
