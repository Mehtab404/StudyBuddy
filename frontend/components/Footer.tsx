const links = [
  {
    label: "GitHub",
    href: "https://github.com/Mehtab404",
    external: true,
    icon: (
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.15-1.11-1.46-1.11-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.9.83.09-.64.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2z" />
    ),
    fill: true,
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/mehtab-alam-7448b5324/",
    external: true,
    icon: (
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    ),
    fill: true,
  },
  {
    label: "Email",
    href: "mailto:mehtabalamnew@gmail.com",
    external: false,
    icon: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    fill: false,
  },
];

export default function Footer() {
  return (
    <footer className="no-print border-t-2 border-ink bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-6">
        <div>
          <p className="font-display font-bold text-ink">Built by Mehtab Alam</p>
          <p className="mt-1 font-mono text-xs uppercase tracking-widest text-stone-500">
            studyBuddy &copy; {new Date().getFullYear()}
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-3">
          {links.map(({ label, href, external, icon, fill }) => (
            <li key={label}>
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="flex items-center gap-2 border-2 border-ink bg-white px-3 py-2 font-display text-sm font-bold text-ink shadow-hard transition-transform hover:-translate-y-0.5 hover:bg-sun"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill={fill ? "currentColor" : "none"}
                  stroke={fill ? "none" : "currentColor"}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {icon}
                </svg>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
