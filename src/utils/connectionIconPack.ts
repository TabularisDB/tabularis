import {
  Server, Database, HardDrive, Cloud, CloudCog, Globe, Lock, ShieldCheck, KeyRound,
  Flame, Bug, Beaker, Wrench, Hammer, Star, Heart, Flag, Bookmark, Folder, Box,
  Archive, Cpu, Activity, Zap, Layers, Network, Truck, Rocket, TestTube, Briefcase,
  type LucideIcon,
} from "lucide-react";

// Curated subset of lucide icons exposed in the per-connection icon picker.
// Keys are the lowercase-first camelCase identifiers that go into
// `IconOverride { type: "pack", id }`.
export const CONNECTION_ICON_PACK: Record<string, LucideIcon> = {
  server: Server,
  database: Database,
  hardDrive: HardDrive,
  cloud: Cloud,
  cloudCog: CloudCog,
  globe: Globe,
  lock: Lock,
  shieldCheck: ShieldCheck,
  keyRound: KeyRound,
  flame: Flame,
  bug: Bug,
  beaker: Beaker,
  wrench: Wrench,
  hammer: Hammer,
  star: Star,
  heart: Heart,
  flag: Flag,
  bookmark: Bookmark,
  folder: Folder,
  box: Box,
  archive: Archive,
  cpu: Cpu,
  activity: Activity,
  zap: Zap,
  layers: Layers,
  network: Network,
  truck: Truck,
  rocket: Rocket,
  testTube: TestTube,
  briefcase: Briefcase,
};

export type ConnectionIconPackId = keyof typeof CONNECTION_ICON_PACK;
