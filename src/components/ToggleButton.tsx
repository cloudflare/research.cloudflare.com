import { useState, useEffect } from "react";
import { cva, type VariantProps } from "class-variance-authority";

const toggleButtonVariants = cva("font-medium text-base py-2 px-[18px] rounded-full border", {
  variants: {
    variant: {
      toggledOff: "border-page-border text-page-text",
      yellow: "text-badge-yellow-text border-badge-yellow-text",
      blue: "text-badge-blue-text border-badge-blue-text bg-badge-blue-bg",
      red: "text-badge-red-text border-badge-red-text",
      green: "text-badge-green-text border-badge-green-text",
      purple: "text-badge-purple-text border-badge-purple-text",
    },
  },
  defaultVariants: {
    variant: "toggledOff",
  },
});

const ToggleButton = ({
  children,
  color,
  defaultValue,
  tagSlug,
}: {
  children: React.ReactNode;
  color: VariantProps<typeof toggleButtonVariants>["variant"];
  defaultValue: boolean;
  tagSlug?: string;
}) => {
  const [isToggled, setToggled] = useState(defaultValue);

  // Sync with URL on mount
  useEffect(() => {
    if (!tagSlug) return;

    const params = new URLSearchParams(window.location.search);
    const tags = params.get("tags")?.split(",") || [];
    setToggled(tags.includes(tagSlug));
  }, [tagSlug]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();

    if (!tagSlug) {
      setToggled((prev) => !prev);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const tags =
      params
        .get("tags")
        ?.split(",")
        .filter((t) => t) || [];

    let newTags: string[];
    if (tags.includes(tagSlug)) {
      // Remove tag
      newTags = tags.filter((t) => t !== tagSlug);
    } else {
      // Add tag
      newTags = [...tags, tagSlug];
    }

    // Build URL manually to avoid URLSearchParams encoding commas
    let newUrl = window.location.pathname;
    if (newTags.length > 0) {
      newUrl += `?tags=${newTags.join(",")}`;
    }

    window.history.pushState({}, "", newUrl);

    // Dispatch custom event for filtering
    window.dispatchEvent(
      new CustomEvent("tagsChanged", {
        detail: { tags: newTags },
      }),
    );

    setToggled((prev) => !prev);
  };

  return (
    <button
      className={toggleButtonVariants({
        variant: isToggled ? color : "toggledOff",
      })}
      onClick={handleClick}
    >
      {children}
    </button>
  );
};

export { ToggleButton };
