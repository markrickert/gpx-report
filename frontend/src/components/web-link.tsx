import type { AnchorHTMLAttributes } from "react";
import { router, type Href } from "expo-router";

/**
 * Web-only drop-in for react-router's <Link to>: a real <a> (so web.css and
 * middle/cmd-click keep working) that does client-side navigation on a plain
 * left click.
 */
export function Link({
  to,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        router.push(to as Href);
      }}
    />
  );
}
