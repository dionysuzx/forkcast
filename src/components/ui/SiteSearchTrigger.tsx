import { getSearchShortcutAriaValue, getSearchShortcutLabel } from '../../utils/searchShortcut';

interface SiteSearchTriggerProps {
  onOpen: () => void;
  placeholder: string;
  ariaLabel: string;
}

export default function SiteSearchTrigger({ onOpen, placeholder, ariaLabel }: SiteSearchTriggerProps) {
  const shortcutLabel = getSearchShortcutLabel();
  const shortcutAriaValue = getSearchShortcutAriaValue();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      aria-keyshortcuts={shortcutAriaValue}
      title={`Open search (${shortcutLabel})`}
      className="group flex w-[136px] sm:w-[240px] items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
    >
      <svg
        className="h-4 w-4 text-slate-400 dark:text-slate-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <span className="flex-1 truncate text-left">{placeholder}</span>
      <kbd className="hidden rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-500 sm:inline dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400">
        {shortcutLabel}
      </kbd>
    </button>
  );
}
