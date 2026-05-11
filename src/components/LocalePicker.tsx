"use client";

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { locales, localeName, swapLocale } from "@/lib/i18n-utils";
import { useTranslations } from "polystella/react";

function GlobeIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 10.13 10.13"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M5.06 0a5.06 5.06 0 1 0 5.07 5.06A5.07 5.07 0 0 0 5.06 0zM9 7.41H7.46a8.56 8.56 0 0 0 .3-2h1.85a4.53 4.53 0 0 1-.61 2zm-2.57 2a4.34 4.34 0 0 0 .91-1.53h1.31a4.57 4.57 0 0 1-2.23 1.54zM1.48 7.89h1.33a4.34 4.34 0 0 0 .91 1.53 4.57 4.57 0 0 1-2.24-1.53zm-1-2.47h1.89a8.59 8.59 0 0 0 .3 2H1.15a4.53 4.53 0 0 1-.63-2zm.57-2.58h1.59a8.75 8.75 0 0 0-.28 2.1H.5a4.53 4.53 0 0 1 .59-2.11zM3.71.71a4.46 4.46 0 0 0-.94 1.64H1.39A4.57 4.57 0 0 1 3.71.71zm5 1.64H7.35A4.46 4.46 0 0 0 6.42.71a4.58 4.58 0 0 1 2.32 1.64zM7.29 4.93H2.84a8.12 8.12 0 0 1 .3-2.1H7a8.12 8.12 0 0 1 .29 2.1zM7 7.41H3.17a8 8 0 0 1-.32-2h4.43a8 8 0 0 1-.28 2zm-.17.48c-.41 1-1 1.72-1.72 1.72s-1.35-.69-1.77-1.72zM3.3 2.35C3.71 1.25 4.35.52 5.06.52s1.35.73 1.77 1.83zm4.47 2.58a8.72 8.72 0 0 0-.28-2.1H9a4.53 4.53 0 0 1 .59 2.1z" />
    </svg>
  );
}

interface LocalePickerProps {
  dict: Record<string, string>;
  locale: string;
  pathname: string;
}

export function LocalePicker({ dict, locale, pathname }: LocalePickerProps) {
  const t = useTranslations(dict);

  return (
    <NavigationMenu viewport={false}>
      <NavigationMenuList>
        <NavigationMenuItem>
          <NavigationMenuTrigger aria-label={t("nav.localePicker.label")} className="text-sm">
            <GlobeIcon size={16} className="text-white" />
            <span lang={locale} className="ml-1.5">
              {localeName(locale)}
            </span>
          </NavigationMenuTrigger>
          <NavigationMenuContent>
            <ul className="grid gap-1 w-[180px] z-(--z-nav) relative p-2">
              {locales.map((targetLocale) => {
                const isCurrent = targetLocale === locale;
                return (
                  <li key={targetLocale}>
                    <NavigationMenuLink asChild>
                      <a
                        href={swapLocale(pathname, targetLocale)}
                        hrefLang={targetLocale}
                        lang={targetLocale}
                        aria-current={isCurrent ? "true" : undefined}
                        className={`group/subnav subnav ${isCurrent ? "font-medium" : ""}`}
                      >
                        <div className="text-sm leading-none subnav-title">{localeName(targetLocale)}</div>
                      </a>
                    </NavigationMenuLink>
                  </li>
                );
              })}
            </ul>
          </NavigationMenuContent>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
}
