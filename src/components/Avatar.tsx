import { useEffect, useState, type CSSProperties } from "react";

/**
 * Player avatar.
 *
 * If you drop character art into `public/avatars/`, the game picks it up
 * automatically using the player's slot:
 *
 *   public/avatars/1.webp ... 8.webp   (or .png)
 *
 * Recommended: transparent PNG or WebP, 512x512, front-facing, same crop.
 * Until then it falls back to the emoji.
 */
export default function Avatar({
  slot,
  emoji,
  className = "",
  emojiClassName = "text-2xl",
  emojiStyle,
}: {
  slot?: number;
  emoji: string;
  className?: string;
  emojiClassName?: string;
  emojiStyle?: CSSProperties;
}) {
  const index = ((slot ?? 0) % 8) + 1;
  const [step, setStep] = useState(0);

  useEffect(() => setStep(0), [index]);

  const sources = [`/avatars/${index}.webp`, `/avatars/${index}.png`];

  if (step < sources.length) {
    return (
      <img
        src={sources[step]}
        alt=""
        draggable={false}
        className={`object-contain ${className}`}
        onError={() => setStep((s) => s + 1)}
      />
    );
  }

  return (
    <span
      className={`grid place-items-center leading-none ${className} ${emojiClassName}`}
      style={emojiStyle}
    >
      {emoji}
    </span>
  );
}
