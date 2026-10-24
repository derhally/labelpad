import { Barcode, CalendarClock, Image, QrCode, Shapes, Smile, Type, type LucideIcon } from "lucide-react";
import type { ElementType } from "../editor/types";

export const TYPE_META: Record<ElementType, { label: string; icon: LucideIcon }> = {
  text: { label: "Text", icon: Type },
  datetime: { label: "Date", icon: CalendarClock },
  image: { label: "Image", icon: Image },
  barcode: { label: "Barcode", icon: Barcode },
  qr: { label: "QR code", icon: QrCode },
  icon: { label: "Icon", icon: Smile },
  shape: { label: "Shape", icon: Shapes },
};

const ORDER: ElementType[] = ["text", "datetime", "image", "barcode", "qr", "icon", "shape"];

export function Toolbar({ onAdd }: { onAdd: (type: ElementType) => void }) {
  return (
    <nav className="toolrail" aria-label="Add to label">
      {ORDER.map((type) => {
        const { label, icon: Icon } = TYPE_META[type];
        return (
          <button key={type} className="tool" onClick={() => onAdd(type)} title={`Add ${label.toLowerCase()}`}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
