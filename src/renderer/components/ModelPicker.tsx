import { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, Search, Check, Star } from "lucide-react";

interface ModelPickerProps {
  models: string[];
  value: string;
  favorites?: string[];
  onChange: (model: string) => void;
  onToggleFavorite?: (model: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
}

export function ModelPicker({
  models,
  value,
  favorites = [],
  onChange,
  onToggleFavorite,
  placeholder = "Select a model…",
  emptyMessage = "No models available. Click 'Fetch Models' first.",
  disabled = false,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Auto-focus search when opened
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const favoriteFiltered = filtered.filter((m) => favoriteSet.has(m));
  const otherFiltered = filtered.filter((m) => !favoriteSet.has(m));

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled || models.length === 0}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md
                   bg-[#1a1a1a] border border-[#333] text-left
                   hover:border-[#D97757]/60 focus:outline-none focus:ring-1 focus:ring-[#D97757]
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate text-[#E0E0E0]">
          {value || <span className="text-[#888]">{placeholder}</span>}
        </span>
        <ChevronDown size={14} className="text-[#888] shrink-0" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-50 mt-1 w-full rounded-md border border-[#333]
                     bg-[#1e1e1e] shadow-lg"
          style={{ maxHeight: 320 }}
        >
          <div className="p-2 border-b border-[#2a2a2a]">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#666]"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models…"
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded
                           bg-[#151515] border border-[#2a2a2a] text-[#E0E0E0]
                           focus:outline-none focus:border-[#D97757]"
              />
            </div>
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: 240 }}>
            {models.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[#888] text-center">
                {emptyMessage}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-[#888] text-center">
                No models match “{query}”
              </div>
            ) : (
              <>
                {favoriteFiltered.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#666] font-semibold">
                      Favorites
                    </div>
                    {favoriteFiltered.map((m) => (
                      <ModelRow
                        key={`fav-${m}`}
                        model={m}
                        selected={m === value}
                        favorited
                        onSelect={() => {
                          onChange(m);
                          setOpen(false);
                          setQuery("");
                        }}
                        onToggleFavorite={() => onToggleFavorite?.(m)}
                      />
                    ))}
                    <div className="border-t border-[#2a2a2a] my-1" />
                  </>
                )}

                {otherFiltered.map((m) => (
                  <ModelRow
                    key={m}
                    model={m}
                    selected={m === value}
                    favorited={false}
                    onSelect={() => {
                      onChange(m);
                      setOpen(false);
                      setQuery("");
                    }}
                    onToggleFavorite={() => onToggleFavorite?.(m)}
                  />
                ))}
              </>
            )}
          </div>

          <div className="px-3 py-2 border-t border-[#2a2a2a] text-[10px] text-[#666]">
            {filtered.length} of {models.length} models
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRow({
  model,
  selected,
  favorited,
  onSelect,
  onToggleFavorite,
}: {
  model: string;
  selected: boolean;
  favorited: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer
                 hover:bg-[#2a2a2a] transition-colors"
      onClick={onSelect}
    >
      <span className="w-4 shrink-0 flex items-center justify-center">
        {selected && <Check size={12} className="text-[#D97757]" />}
      </span>
      <span className="flex-1 truncate text-[#E0E0E0]">{model}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
        title={favorited ? "Unfavorite" : "Favorite"}
      >
        <Star
          size={12}
          className={favorited ? "text-[#D97757] fill-[#D97757]" : "text-[#666]"}
        />
      </button>
    </div>
  );
}
