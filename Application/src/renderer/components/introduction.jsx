import React, { useMemo, useState } from 'react';

export default function Introduction({ isOpen, onOpenChange }) {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const timeZones = useMemo(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }

    return [detectedTimeZone];
  }, [detectedTimeZone]);

  const [formData, setFormData] = useState(() => ({
    name:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-user-name') || ''
        : '',
    timeZone:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-user-timezone') || detectedTimeZone
        : detectedTimeZone,
  }));

  function handleChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('calendar-user-name', formData.name.trim());
      window.localStorage.setItem('calendar-user-timezone', formData.timeZone);
    }
    onOpenChange?.(false);
  }

  if (!isOpen) {
    return null;
  }

  return (
    <section className="flex w-full flex-col gap-3">
      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-[24px] border border-slate-900/8 bg-white/70 p-5 shadow-[0_18px_50px_rgba(36,52,89,0.10)] backdrop-blur-md md:grid-cols-[1fr_1fr_auto]"
      >
        <div className="grid gap-2">
          <label htmlFor="name" className="text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="Optional"
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="grid gap-2">
          <label htmlFor="timeZone" className="text-sm font-medium text-slate-700">
            Timezone
          </label>
          <select
            id="timeZone"
            name="timeZone"
            value={formData.timeZone}
            onChange={handleChange}
            className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            {timeZones.map((timeZone) => (
              <option key={timeZone} value={timeZone}>
                {timeZone}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end justify-end">
          <button
            type="submit"
            className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Save
          </button>
        </div>
      </form>
    </section>
  );
}
