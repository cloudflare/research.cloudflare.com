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
import { locales, localeName, swapLocale } from "@/lib/i18n-utils";
import { useLocalizedHref, useTranslations } from "polystella/react";

interface NavMenuProps {
  dict: Record<string, string>;
  locale: string;
  /** `Astro.url.pathname` for the mobile drawer's locale links. */
  pathname: string;
}

export function NavMenu({ dict, locale, pathname }: NavMenuProps) {
  const t = useTranslations(dict);
  const lhref = useLocalizedHref(locale);
  const isMobile = useIsMobile();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [focusAreasOpen, setFocusAreasOpen] = React.useState(false);
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const [languageOpen, setLanguageOpen] = React.useState(false);

  const components: { title: string; href: string; description: string }[] = React.useMemo(
    () => [
      {
        title: t("nav.focusAreas.all.title"),
        href: lhref("/focus"),
        description: t("nav.focusAreas.all.description"),
      },
      {
        title: t("globals.morePrivate"),
        href: lhref("/focus/private"),
        description: t("nav.focusAreas.morePrivate.description"),
      },
      {
        title: t("globals.safer"),
        href: lhref("/focus/safe"),
        description: t("nav.focusAreas.safer.description"),
      },
      {
        title: t("globals.faster"),
        href: lhref("/focus/fast"),
        description: t("nav.focusAreas.faster.description"),
      },
      {
        title: t("globals.moreReliable"),
        href: lhref("/focus/reliable"),
        description: t("nav.focusAreas.moreReliable.description"),
      },
      {
        title: t("globals.moreMeasurable"),
        href: lhref("/focus/measurable"),
        description: t("nav.focusAreas.moreMeasurable.description"),
      },
    ],
    [t, lhref],
  );

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
          aria-label={t("a11y.toggleMenu")}
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
                aria-label={t("a11y.closeMenu")}
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
                  {t("nav.focusAreas")}
                  <span className="text-sm pr-3">{focusAreasOpen ? "−" : "+"}</span>
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
                        <div className="text-base font-medium text-page-text">{component.title}</div>
                        <p className="text-sm text-page-text-muted mt-1">{component.description}</p>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Other Navigation Items */}
              <a
                href={lhref("/presentations")}
                className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.presentations")}
              </a>

              {/* About Section */}
              <div>
                <button
                  onClick={() => setAboutOpen(!aboutOpen)}
                  className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors w-full text-left flex items-center justify-between"
                >
                  {t("nav.aboutUs")}
                  <span className="text-sm pr-3">{aboutOpen ? "−" : "+"}</span>
                </button>
                {aboutOpen && (
                  <div className="mt-4 space-y-4 pl-4">
                    <a
                      href={lhref("/people")}
                      className="block text-base font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {t("nav.people")}
                    </a>
                    <a
                      href={lhref("/philosophy")}
                      className="block text-base font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {t("nav.philosophy")}
                    </a>
                  </div>
                )}
              </div>

              {/* Language section */}
              <div>
                <button
                  onClick={() => setLanguageOpen(!languageOpen)}
                  className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors w-full text-left flex items-center justify-between"
                  aria-label={t("nav.localePicker.label")}
                  aria-expanded={languageOpen}
                >
                  {t("nav.localePicker.label")}
                  <span className="text-sm pr-3">{languageOpen ? "−" : "+"}</span>
                </button>
                {languageOpen && (
                  <div className="mt-4 space-y-4 pl-4">
                    {locales.map((targetLocale) => {
                      const isCurrent = targetLocale === locale;
                      return (
                        <a
                          key={targetLocale}
                          href={swapLocale(pathname, targetLocale)}
                          hrefLang={targetLocale}
                          lang={targetLocale}
                          aria-current={isCurrent ? "true" : undefined}
                          className={`block text-base text-page-text hover:text-baby-blue-eyes transition-colors ${isCurrent ? "font-medium" : ""}`}
                          onClick={() => setMobileMenuOpen(false)}
                        >
                          {localeName(targetLocale)}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>

              <a
                href={CONSTANTS.CLOUDFLARE_JOBS}
                className="text-lg font-medium text-page-text hover:text-baby-blue-eyes transition-colors"
                onClick={() => setMobileMenuOpen(false)}
              >
                {t("nav.careers")}
              </a>
            </nav>
          </div>
        )}
      </div>

      {/* Desktop Navigation Menu */}
      <NavigationMenu viewport={isMobile} className="hidden md:flex">
        <NavigationMenuList className="flex-wrap">
          <NavigationMenuItem>
            <NavigationMenuTrigger>{t("nav.focusAreas")}</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid gap-2 sm:w-[400px] md:w-[500px] md:grid-cols-2 lg:w-[600px] z-(--z-nav) relative">
                {components.map((component) => (
                  <ListItem key={component.title} title={component.title} href={component.href}>
                    {component.description}
                  </ListItem>
                ))}
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>
          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <a href={lhref("/presentations")}>{t("nav.presentations")}</a>
            </NavigationMenuLink>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuTrigger>{t("nav.aboutUs")}</NavigationMenuTrigger>
            <NavigationMenuContent>
              <ul className="grid gap-2 w-[200px] z-(--z-nav) relative p-2">
                <ListItem title={t("nav.people")} href={lhref("/people")} />
                <ListItem title={t("nav.philosophy")} href={lhref("/philosophy")} />
              </ul>
            </NavigationMenuContent>
          </NavigationMenuItem>

          <NavigationMenuItem>
            <NavigationMenuLink asChild className={navigationMenuTriggerStyle()}>
              <a href={CONSTANTS.CLOUDFLARE_JOBS}>{t("nav.careers")}</a>
            </NavigationMenuLink>
          </NavigationMenuItem>
        </NavigationMenuList>
      </NavigationMenu>
    </>
  );
}

function ListItem({ title, children, href, ...props }: React.ComponentPropsWithoutRef<"li"> & { href: string }) {
  return (
    <li {...props}>
      <NavigationMenuLink asChild>
        <a href={href} className="group/subnav subnav">
          <div className="text-sm leading-none font-medium subnav-title">{title}</div>
          {children && <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">{children}</p>}
        </a>
      </NavigationMenuLink>
    </li>
  );
}
