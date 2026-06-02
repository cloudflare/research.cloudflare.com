"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";

import { useIsMobile } from "@/hooks/useMobile";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import { CONSTANTS } from "@/lib/constants";

const components: { title: string; href: string; description: string }[] = [
  {
    title: "All Focus Areas",
    href: "/focus",
    description:
      "Driving innovation across five key areas to create a faster, safer, more private, reliable, and measurable Internet.",
  },
  {
    title: "More Private",
    href: "/focus/private",
    description:
      "Developing privacy-preserving systems and protocols that protect users while enabling a more secure and trustworthy Internet.",
  },
  {
    title: "Safer",
    href: "/focus/safe",
    description:
      "Creating production-quality security defenses that address network interference and ensure safe, reliable global connectivity.",
  },
  {
    title: "Faster",
    href: "/focus/fast",
    description:
      "Advancing distributed systems and caching technologies that minimize latency and accelerate the global Internet.",
  },
  {
    title: "More Reliable",
    href: "/focus/reliable",
    description:
      "Building robust distributed systems and time synchronization protocols that ensure the Internet remains stable and available at scale.",
  },
  {
    title: "More Measurable",
    href: "/focus/measurable",
    description:
      "Promoting accountability in Internet infrastructure through open standards like Certificate Transparency and tools that make critical systems verifiable.",
  },
];

export function NavMenu() {
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [focusAreasOpen, setFocusAreasOpen] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);

  // Lock body scroll when mobile menu is open
  React.useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  return (
    <>
      {/* Mobile Hamburger Menu */}
      <div className="md:hidden">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-page-text hover:text-baby-blue-eyes transition-colors"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 mobile-nav z-9998 overflow-y-auto">
            {/* Close button header */}
            <div className="flex items-center justify-end pt-4 pb-0 px-3 sm:px-5">
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 text-page-text hover:text-baby-blue-eyes transition-colors"
                aria-label="Close menu"
              >
                <X size={24} />
              </button>
            </div>

            <nav className="flex flex-col p-6 space-y-6">
              {/* Focus Areas Section */}
              <div>
                <button
                  onClick={() => setFocusAreasOpen(!focusAreasOpen)}
                  className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors w-full text-left flex items-center justify-between"
                >
                  Focus Areas
                  <span className="text-sm pr-3">
                    {focusAreasOpen ? "−" : "+"}
                  </span>
                </button>
                {focusAreasOpen && (
                  <div className="mt-4 space-y-4 pl-4">
                    {components.map((component) => (
                      <a
                        key={component.title}
                        href={component.href}
                        className="block mobile-nav-text"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        <div className="text-base font-medium text-page-text">
                          {component.title}
                        </div>
                        <p className="text-sm text-page-text-muted mt-1">
                          {component.description}
                        </p>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Other Navigation Items */}
              <a
                href="/presentations"
                className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Presentations
              </a>

              {/* About Section */}
              <div>
                <button
                  onClick={() => setAboutOpen(!aboutOpen)}
                  className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors w-full text-left flex items-center justify-between"
                >
                  About Us
                  <span className="text-sm pr-3">{aboutOpen ? "−" : "+"}</span>
                </button>
                {aboutOpen && (
                  <div className="mt-4 space-y-4 pl-4">
                    <a
                      href="/people"
                      className="block text-base font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      People
                    </a>
                    <a
                      href="/philosophy"
                      className="block text-base font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Philosophy
                    </a>
                  </div>
                )}
              </div>

              <a
                href={CONSTANTS.CLOUDFLARE_JOBS}
                className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                Careers
              </a>
            </nav>
          </div>
        )}
      </div>

      {/* Desktop Navigation Menu */}
      <NavigationMenu viewport={isMobile} className="hidden md:flex">
        <NavigationMenuList className="flex-wrap">
          <NavigationMenuItem>
            <NavigationMenuTrigger>Focus Areas</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid gap-2 sm:w-[400px] md:w-[500px] md:grid-cols-2 lg:w-[600px] z-(--z-nav) relative">
                {components.map((component) => (
                  <ListItem
                    key={component.title}
                    title={component.title}
                    href={component.href}
                  >
                    {component.description}
                  </ListItem>
                ))}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink
              asChild
              className={navigationMenuTriggerStyle()}
            >
              <a href="/presentations">Presentations</a>
            </NavigationMenuLink>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuTrigger>About Us</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid gap-2 w-[200px] z-(--z-nav) relative p-2">
                <ListItem title="People" href="/people" />
                <ListItem title="Philosophy" href="/philosophy" />
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink
              asChild
              className={navigationMenuTriggerStyle()}
            >
              <a href={CONSTANTS.CLOUDFLARE_JOBS}>Careers</a>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </>
  );
}

function ListItem({
  title,
  children,
  href,
  ...props
}: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <a href={href} title={title} className="group/subnav subnav">
          <div className="text-sm leading-none font-medium subnav-title">
            {title}
          </div>
          {children && (
            <p className="text-muted-foreground text-sm leading-snug">
              {children}
            </p>
          )}
        </a>
      </NavigationMenuLink>
    </li>
  );
}
