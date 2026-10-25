import { icons as LUCIDE, type LucideIcon } from "lucide-react";
import {
  AlertTriangle, Apple, Archive, Baby, Battery, Beer, Bike, Book, Bookmark, Box, Briefcase, Bug, Cable, Cake,
  Calendar, Camera, Car, Carrot, Cat, Check, ChefHat, Cherry, Circle, Clock, Cloud, Coffee, Cog, Cookie, Cpu, CreditCard,
  Croissant, Database, Dog, DoorOpen, Droplet, Dumbbell, Egg, Fan, File, FileText, Fish, Flag, Flame, FlaskConical,
  Flower, Folder, Gamepad2, Gift, GlassWater, Globe, GraduationCap, Hammer, HardDrive, Headphones, Heart, Home, Key,
  Lamp, Laptop, Leaf, Lightbulb, Lock, Mail, MapPin, Microwave, Milk, Monitor, Moon, Mouse, Music, Package, Paintbrush,
  Palette, Paperclip, PawPrint, Pen, Phone, Pill, Pizza, Plane, Plug, Power, Printer, Recycle, Refrigerator, Router,
  Ruler, Salad, Sandwich, Scissors, Shirt, ShoppingCart, Skull, Snowflake, Sofa, Soup, Sparkles, Sprout, Square, Star,
  Sun, Syringe, Tag, Thermometer, ThumbsUp, Trash2, Trees, Truck, Tv, Umbrella, User, Usb, Utensils, Wand2, Wheat, Wifi,
  Wine, Wrench, X, Zap,
} from "lucide-react";

/**
 * A curated set of icons that suit labels: storage, kitchen, workshop, office and warnings.
 * Keyed by a stable id that's stored in label files. The picker shows these first.
 */
const POPULAR: Record<string, LucideIcon> = {
  "alert-triangle": AlertTriangle, apple: Apple, archive: Archive, baby: Baby, battery: Battery, beer: Beer, bike: Bike,
  book: Book, bookmark: Bookmark, box: Box, briefcase: Briefcase, bug: Bug, cable: Cable, cake: Cake, calendar: Calendar,
  camera: Camera, car: Car, carrot: Carrot, cat: Cat, check: Check, "chef-hat": ChefHat, cherry: Cherry, circle: Circle,
  clock: Clock, cloud: Cloud, coffee: Coffee, cog: Cog, cookie: Cookie, cpu: Cpu, "credit-card": CreditCard,
  croissant: Croissant, database: Database, dog: Dog, "door-open": DoorOpen, droplet: Droplet, dumbbell: Dumbbell,
  egg: Egg, fan: Fan, file: File, "file-text": FileText, fish: Fish, flag: Flag, flame: Flame, flask: FlaskConical,
  flower: Flower, folder: Folder, gamepad: Gamepad2, gift: Gift, "glass-water": GlassWater, globe: Globe,
  "graduation-cap": GraduationCap, hammer: Hammer, "hard-drive": HardDrive, headphones: Headphones, heart: Heart,
  home: Home, key: Key, lamp: Lamp, laptop: Laptop, leaf: Leaf, lightbulb: Lightbulb, lock: Lock, mail: Mail,
  "map-pin": MapPin, microwave: Microwave, milk: Milk, monitor: Monitor, moon: Moon, mouse: Mouse, music: Music,
  package: Package, paintbrush: Paintbrush, palette: Palette, paperclip: Paperclip, paw: PawPrint, pen: Pen, phone: Phone,
  pill: Pill, pizza: Pizza, plane: Plane, plug: Plug, power: Power, printer: Printer, recycle: Recycle,
  fridge: Refrigerator, router: Router, ruler: Ruler, salad: Salad, sandwich: Sandwich, scissors: Scissors, shirt: Shirt,
  cart: ShoppingCart, skull: Skull, snowflake: Snowflake, sofa: Sofa, soup: Soup, sparkles: Sparkles, sprout: Sprout,
  square: Square, star: Star, sun: Sun, syringe: Syringe, tag: Tag, thermometer: Thermometer, "thumbs-up": ThumbsUp,
  trash: Trash2, trees: Trees, truck: Truck, tv: Tv, umbrella: Umbrella, user: User, usb: Usb, utensils: Utensils,
  wand: Wand2, wheat: Wheat, wifi: Wifi, wine: Wine, wrench: Wrench, x: X, zap: Zap,
};

/** Every Lucide icon, by its kebab-case name ("ChevronUp" is "chevron-up"), after the popular ones. */
export const ICONS: Record<string, LucideIcon> = { ...POPULAR };
for (const [name, Icon] of Object.entries(LUCIDE)) {
  const id = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
  ICONS[id] ??= Icon;
}

export const POPULAR_IDS = Object.keys(POPULAR);
export const ICON_IDS = Object.keys(ICONS);
