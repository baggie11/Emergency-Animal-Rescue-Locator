import { PhoneIcon, AlertIcon } from './icons.jsx';

/**
 * The emergency banner pinned to the top of the page.
 *
 * Deliberately the loudest element on screen and always visible: a person
 * bleeding next to a dog should be able to hit a number without scrolling.
 * The phone number is configurable at runtime from the admin panel.
 */
export default function HelplineBanner({ config, hideNote = false, onDismissNote }) {
  const phone = config?.helplinePhone || '112';
  const label = config?.helplineLabel || 'Emergency helpline';
  const isPlaceholder = config?.isSampleData !== 'false';

  return (
    <div className="bg-brand-600 text-white">
      <a
        href={`tel:${String(phone).replace(/[^\d+]/g, '')}`}
        className="flex min-h-14 items-center gap-3 px-4 py-2.5 active:bg-brand-700"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20">
          <PhoneIcon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold tracking-wide text-white/85 uppercase">
            {label}
          </span>
          <span className="block text-xl leading-tight font-bold">{phone}</span>
        </span>
        <span className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-bold text-brand-700">
          Call
        </span>
      </a>

      {config?.helplineNote && isPlaceholder && !hideNote && (
        <button
          type="button"
          onClick={onDismissNote}
          className="flex w-full items-start gap-2 bg-brand-700/70 px-4 py-2 text-left text-xs text-white/95"
        >
          <AlertIcon size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>Before public launch:</strong> {config.helplineNote}
            <span className="ml-1 underline">Tap to hide</span>
          </span>
        </button>
      )}
    </div>
  );
}
