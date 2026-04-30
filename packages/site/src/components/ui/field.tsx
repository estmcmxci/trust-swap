import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  prefix?: ReactNode;
  suffix?: ReactNode;
  children: ReactNode;
}

/**
 * Form field shell. Label above, input via children, hint/error below.
 * Accepts an optional prefix/suffix rendered inside the input frame
 * (e.g. a "$" sign for amount inputs).
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  prefix,
  suffix,
  children,
}: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-muted">
          {label}
          {required && <span className="ml-1 text-gold-500">*</span>}
        </span>
      </span>
      <span
        className={`flex items-center rounded-xl border bg-white px-3.5 py-2.5 text-[14px] transition-colors duration-150 focus-within:shadow-ring focus-within:border-brand-500 ${
          error
            ? "border-gold-400"
            : "border-[color:var(--hairline-strong)] hover:border-ink-faint"
        }`}
      >
        {prefix && (
          <span className="mr-2 shrink-0 text-ink-faint" aria-hidden="true">
            {prefix}
          </span>
        )}
        <span className="flex-1 min-w-0">{children}</span>
        {suffix && (
          <span className="ml-2 shrink-0 text-ink-faint" aria-hidden="true">
            {suffix}
          </span>
        )}
      </span>
      {(hint || error) && (
        <span
          className={`mt-1.5 block text-[11.5px] leading-snug ${
            error ? "text-gold-700" : "text-ink-faint"
          }`}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { mono?: boolean };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = "", mono = false, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`w-full bg-transparent text-ink outline-none placeholder:text-ink-faint ${
        mono ? "font-mono" : ""
      } ${className}`}
      {...rest}
    />
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className = "", ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={`w-full bg-transparent text-ink outline-none appearance-none cursor-pointer ${className}`}
        {...rest}
      />
    );
  },
);

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  label: string;
  hint?: string;
  id?: string;
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  id,
}: ToggleProps) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onCheckedChange(!checked)}
        className={`mt-0.5 inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:shadow-ring ${
          checked
            ? "border-brand-500 bg-brand-500"
            : "border-[color:var(--hairline-strong)] bg-paper-subtle"
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink cursor-pointer">
          {label}
        </label>
        {hint && (
          <div className="text-[11.5px] leading-snug text-ink-faint">{hint}</div>
        )}
      </div>
    </div>
  );
}
