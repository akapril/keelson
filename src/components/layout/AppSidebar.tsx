import { NavLink } from "react-router-dom";

const items = [
  { to: "/sessions", label: "会话中枢" },
  { to: "/settings", label: "设置" },
];

export function AppSidebar() {
  return (
    <nav className="w-48 shrink-0 border-r border-border p-2">
      {items.map((i) => (
        <NavLink
          key={i.to}
          to={i.to}
          className={({ isActive }) =>
            `block rounded-md px-3 py-2 text-sm ${
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`
          }
        >
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
