import { forwardRef, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  loading?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-brand-500 text-white shadow-[0_4px_14px_-4px_rgba(30,64,175,0.6)] hover:bg-brand-600 active:bg-brand-700 focus-visible:shadow-ring",
  secondary:
    "bg-white text-ink border border-[color:var(--hairline-strong)] hover:bg-paper-subtle active:bg-paper-deep focus-visible:shadow-ring",
  ghost:
    "bg-transparent text-ink-soft hover:bg-paper-subtle hover:text-ink focus-visible:shadow-ring",
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps["size"]>, string> = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className = "",
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium tracking-[-0.01em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {loading ? (
          <>
            <Spinner />
            <span>working</span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);

function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
    </svg>
  );
}
