"use client";

import {
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

type ArtSize = "4x6" | "6x9";
type Surface = "front" | "back";
type ElementKind = "text" | "shape" | "image";
type ValidationStatus = "pass" | "warn" | "blocked";
type IssueLevel = "warning" | "blocked";

type ArtworkElement = {
  id: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  fill?: string;
  src?: string;
};

type ZoneKind = "clear" | "address" | "return" | "imposed";

type ZoneSpec = {
  label: string;
  kind: ZoneKind;
  rect: { x: number; y: number; width: number; height: number };
};

type SurfaceState = {
  baseGraphicUrl: string | null;
  logoUrl: string | null;
  logoMeta: { width: number; height: number } | null;
  baseMeta: { width: number; height: number } | null;
  elements: ArtworkElement[];
};

type ValidationIssue = {
  level: IssueLevel;
  message: string;
};

type ValidationSummary = {
  status: ValidationStatus;
  issues: ValidationIssue[];
};

type ImageSourceMeta = {
  dataUrl: string;
  width?: number;
  height?: number;
};

type PersistedArtworkElement =
  | {
      id: string;
      kind: "text";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      text: string;
      fontSize?: number;
      fontFamily?: string;
      color?: string;
      [key: string]: unknown;
    }
  | {
      id: string;
      kind: "shape";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      fill: string;
      [key: string]: unknown;
    }
  | {
      id: string;
      kind: "image";
      x: number;
      y: number;
      width: number;
      height: number;
      rotation?: number;
      src: string;
      [key: string]: unknown;
    };

type PersistedSurface = {
  baseGraphic?: ImageSourceMeta | null;
  logo?: ImageSourceMeta | null;
  baseMeta?: {
    width: number;
    height: number;
  } | null;
  logoMeta?: {
    width: number;
    height: number;
  } | null;
  elements: PersistedArtworkElement[];
};

type SavedDesign = {
  id: string;
  name: string;
  size: ArtSize;
  validation_status: ValidationStatus;
  validation_issues: unknown;
  front_state: PersistedSurface | null;
  back_state: PersistedSurface | null;
  phase1_document: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type SavedDesignResponse = {
  design: SavedDesign;
};

type SavedDesignListResponse = {
  designs: SavedDesign[];
};

type Interaction =
  | {
      kind: "move";
      elementId: string;
      surface: Surface;
      pointerId: number;
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "resize";
      elementId: string;
      surface: Surface;
      pointerId: number;
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
    }
  | null;

type Phase1Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Phase1LogoOrImageElement = {
  kind: "logo" | "image";
  x: number;
  y: number;
  width: number;
  height: number;
  source: {
    url: string;
    format: "png" | "jpg" | "jpeg";
  };
  rotation?: number;
};

type Phase1ShapeElement = {
  kind: "shape";
  shape: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  fillColor?: string;
  rotation?: number;
};

type Phase1TextElement = {
  kind: "text";
  x: number;
  y: number;
  width?: number;
  text: string;
  fontSize?: number;
  color?: string;
  rotation?: number;
};

type Phase1Element = Phase1LogoOrImageElement | Phase1ShapeElement | Phase1TextElement;

type Phase1Surface = {
  baseGraphic?: {
    url: string;
    format: "png" | "jpg" | "jpeg";
  };
  elements: Phase1Element[];
  clearZones: Phase1Rect[];
  addressZones: Phase1Rect[];
};

type Phase1Document = {
  size: ArtSize;
  front: Phase1Surface;
  back: Phase1Surface;
  bleedInches: number;
  dpi: number;
};

const CANVAS_SPECS: Record<ArtSize, { widthIn: number; heightIn: number; pxPerInch: number }> = {
  "4x6": { widthIn: 6, heightIn: 4, pxPerInch: 80 },
  "6x9": { widthIn: 9, heightIn: 6, pxPerInch: 80 },
};

const ZONES: Record<ArtSize, ZoneSpec[]> = {
  "4x6": [
    { kind: "clear", label: "Address clear", rect: { x: 0, y: 0, width: 6, height: 0.25 } },
    { kind: "address", label: "Address/IMB", rect: { x: 4.6, y: 0.5, width: 1.3, height: 1.35 } },
    { kind: "return", label: "Return", rect: { x: 0.15, y: 2.7, width: 1.5, height: 0.5 } },
    { kind: "imposed", label: "Indicia", rect: { x: 0.15, y: 3.2, width: 1.5, height: 0.35 } },
  ],
  "6x9": [
    { kind: "clear", label: "Address clear", rect: { x: 0, y: 0, width: 9, height: 0.25 } },
    { kind: "address", label: "Address/IMB", rect: { x: 7.2, y: 0.5, width: 1.3, height: 1.35 } },
    { kind: "return", label: "Return", rect: { x: 0.15, y: 4.0, width: 1.8, height: 0.55 } },
    { kind: "imposed", label: "Indicia", rect: { x: 0.15, y: 4.75, width: 1.8, height: 0.4 } },
  ],
};

const PHASE1_DOC = {
  bleedInches: 0.125,
  dpi: 300,
};

const FONT_FAMILIES = [
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia" },
  { value: "Gotham", label: "Gotham" },
];

const DEFAULT_LOGO_SIZE_PX = { min4x6: 960, min6x9: 1440 };
const DEFAULT_SURFACE: SurfaceState = {
  baseGraphicUrl: null,
  logoUrl: null,
  logoMeta: null,
  baseMeta: null,
  elements: [],
};

function rectIntersects(a: ZoneSpec["rect"], b: { x: number; y: number; width: number; height: number }) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function toClientRectPx(
  inches: { x: number; y: number; width: number; height: number },
  pxPerInch: number,
) {
  return {
    left: inches.x * pxPerInch,
    top: inches.y * pxPerInch,
    width: Math.max(0.01, inches.width) * pxPerInch,
    height: Math.max(0.01, inches.height) * pxPerInch,
  };
}

function elementLabel(el: ArtworkElement) {
  if (el.kind === "text") return `Text ${el.id.slice(-4)}`;
  if (el.kind === "shape") return `Shape ${el.id.slice(-4)}`;
  return `Image ${el.id.slice(-4)}`;
}

function isDataUrlImage(value: string | null): value is string {
  return !!value && value.startsWith("data:image/");
}

function isDataUrlPdf(value: string | null): value is string {
  return !!value && value.startsWith("data:application/pdf");
}

function inferImageFormat(dataUrl: string): "png" | "jpeg" | "jpg" | undefined {
  if (dataUrl.startsWith("data:image/png")) return "png";
  if (dataUrl.startsWith("data:image/jpeg")) return "jpeg";
  if (dataUrl.startsWith("data:image/jpg")) return "jpg";
  return undefined;
}

async function probeImageMeta(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith("image/")) return null;

  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const meta = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.length > 0) {
        resolve(reader.result);
      } else {
        reject(new Error("Unable to read file data"));
      }
    };
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}
function toValidationStatus(issues: ValidationIssue[]): ValidationStatus {
  if (issues.some((issue) => issue.level === "blocked")) return "blocked";
  if (issues.length > 0) return "warn";
  return "pass";
}

function toPersistedSurface(surface: SurfaceState): PersistedSurface {
  const elements: PersistedArtworkElement[] = surface.elements.map((element) => {
    if (element.kind === "text") {
      return {
        id: element.id,
        kind: "text",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        text: element.text ?? "",
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        color: element.color,
      };
    }

    if (element.kind === "shape") {
      return {
        id: element.id,
        kind: "shape",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation,
        fill: element.fill ?? "#2563eb4d",
      };
    }

    return {
      id: element.id,
      kind: "image",
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation,
      src: element.src ?? "",
    };
  });

  return {
    baseGraphic: surface.baseGraphicUrl ? { dataUrl: surface.baseGraphicUrl, ...(surface.baseMeta ?? {}) } : null,
    logo: surface.logoUrl ? { dataUrl: surface.logoUrl, ...(surface.logoMeta ?? {}) } : null,
    baseMeta: surface.baseMeta,
    logoMeta: surface.logoMeta,
    elements,
  };
}

function fromPersistedSurface(surface: PersistedSurface | null | undefined): SurfaceState {
  if (!surface) return { ...DEFAULT_SURFACE };

  const elements: ArtworkElement[] = [];

  for (const element of surface.elements ?? []) {
    if (!element || typeof element !== "object") continue;

    if (element.kind === "text") {
      if (typeof element.text !== "string") continue;
      elements.push({
        id: element.id,
        kind: "text",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation ?? 0,
        text: element.text,
        fontSize: element.fontSize,
        fontFamily: element.fontFamily,
        color: element.color,
      });
    } else if (element.kind === "shape") {
      elements.push({
        id: element.id,
        kind: "shape",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation ?? 0,
        fill: element.fill,
      });
    } else if (element.kind === "image") {
      if (typeof element.src !== "string") continue;
      elements.push({
        id: element.id,
        kind: "image",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        rotation: element.rotation ?? 0,
        src: element.src,
      });
    }
  }

  return {
    baseGraphicUrl: surface.baseGraphic?.dataUrl ?? null,
    logoUrl: surface.logo?.dataUrl ?? null,
    logoMeta: (surface.logoMeta?.width && surface.logoMeta?.height)
      ? { width: surface.logoMeta.width, height: surface.logoMeta.height }
      : null,
    baseMeta: (surface.baseMeta?.width && surface.baseMeta?.height)
      ? { width: surface.baseMeta.width, height: surface.baseMeta.height }
      : null,
    elements,
  };
}

function pickImageSource(surface: SurfaceState): string | null {
  if (isDataUrlImage(surface.logoUrl)) return surface.logoUrl;
  if (isDataUrlImage(surface.baseGraphicUrl)) return surface.baseGraphicUrl;
  return null;
}

function buildValidation(state: Record<Surface, SurfaceState>, size: ArtSize): ValidationSummary {
  const issues: ValidationIssue[] = [];
  const zones = ZONES[size];

  for (const surface of ["front", "back"] as Surface[]) {
    const current = state[surface];
    const { widthIn, heightIn } = CANVAS_SPECS[size];

    for (const el of current.elements) {
      if (el.x < 0 || el.y < 0 || el.x + el.width > widthIn || el.y + el.height > heightIn) {
        issues.push({
          level: "blocked",
          message: `${surface}: element ${elementLabel(el)} extends outside the trim area.`,
        });
      }

      for (const zone of zones) {
        if (!rectIntersects(zone.rect, el)) continue;
        if (zone.kind === "clear") {
          issues.push({
            level: "warning",
            message: `${surface}: ${elementLabel(el)} is overlapping a clear zone (${zone.label}).`,
          });
        } else if (zone.kind === "address") {
          issues.push({
            level: "warning",
            message: `${surface}: ${elementLabel(el)} is overlapping address/IMB.`,
          });
        } else if (zone.kind === "return") {
          issues.push({
            level: "warning",
            message: `${surface}: ${elementLabel(el)} is overlapping return area.`,
          });
        } else if (zone.kind === "imposed") {
          issues.push({
            level: "warning",
            message: `${surface}: ${elementLabel(el)} is overlapping indicia area.`,
          });
        }
      }
    }

    if (current.logoMeta) {
      const minDim = size === "4x6" ? DEFAULT_LOGO_SIZE_PX.min4x6 : DEFAULT_LOGO_SIZE_PX.min6x9;
      if (
        current.logoMeta.width < minDim ||
        current.logoMeta.height < Math.round((minDim * current.logoMeta.height) / current.logoMeta.width)
      ) {
        issues.push({
          level: "blocked",
          message: `${surface}: uploaded logo appears too small for print quality.`,
        });
      }
    }

    if (current.baseGraphicUrl && !isDataUrlImage(current.baseGraphicUrl) && isDataUrlPdf(current.baseGraphicUrl)) {
      issues.push({
        level: "warning",
        message: `${surface}: base graphic is a PDF; final appearance may vary until render time.`,
      });
    }

    if (current.baseMeta) {
      const safeBaseDpi =
        current.baseMeta.width > 0
          ? Math.min(current.baseMeta.width / widthIn, current.baseMeta.height / heightIn)
          : null;
      if (safeBaseDpi && safeBaseDpi < 180) {
        issues.push({
          level: "blocked",
          message: `${surface}: base graphic DPI is below print minimum.`,
        });
      } else if (safeBaseDpi && safeBaseDpi < 240) {
        issues.push({
          level: "warning",
          message: `${surface}: base graphic DPI may be weak for full-quality print.`,
        });
      }
    } else if (current.baseGraphicUrl) {
      issues.push({
        level: "warning",
        message: `${surface}: unable to confirm base graphic print resolution.`,
      });
    }
  }

  return {
    status: toValidationStatus(issues),
    issues,
  };
}

function buildPhase1Surface(surface: SurfaceState, size: ArtSize): Phase1Surface {
  const clearZones = ZONES[size]
    .filter((zone) => zone.kind === "clear")
    .map((zone) => ({ ...zone.rect }));
  const addressZones = ZONES[size]
    .filter((zone) => zone.kind === "address")
    .map((zone) => ({ ...zone.rect }));

  const elements: Phase1Element[] = [];

  for (const element of surface.elements) {
    if (element.kind === "text") {
      elements.push({
        kind: "text",
        x: element.x,
        y: element.y,
        width: element.width,
        text: element.text ?? "",
        fontSize: element.fontSize,
        color: element.color,
        rotation: element.rotation,
      });
      continue;
    }

    if (element.kind === "shape") {
      elements.push({
        kind: "shape",
        shape: "rect",
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
        fillColor: element.fill,
        rotation: element.rotation,
      });
      continue;
    }

    const src = element.src;
    if (typeof src === "string" && isDataUrlImage(src)) {
      const format = inferImageFormat(src);
      if (format) {
        elements.push({
          kind: "image",
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          rotation: element.rotation,
          source: {
            url: src,
            format,
          },
        });
      }
    }
  }

  return {
    baseGraphic: isDataUrlImage(surface.baseGraphicUrl)
      ? {
          url: surface.baseGraphicUrl,
          format: inferImageFormat(surface.baseGraphicUrl) ?? "png",
        }
      : undefined,
    elements,
    clearZones,
    addressZones,
  };
}

function toPhase1Document(size: ArtSize, front: SurfaceState, back: SurfaceState): Phase1Document {
  return {
    size,
    front: buildPhase1Surface(front, size),
    back: buildPhase1Surface(back, size),
    bleedInches: PHASE1_DOC.bleedInches,
    dpi: PHASE1_DOC.dpi,
  };
}

export function MailArtworkEditor() {
  const [size, setSize] = useState<ArtSize>("4x6");
  const [activeSurface, setActiveSurface] = useState<Surface>("front");
  const [designName, setDesignName] = useState("Draft");
  const [activeDesignId, setActiveDesignId] = useState("");

  const [surfaces, setSurfaces] = useState<Record<Surface, SurfaceState>>({
    front: { ...DEFAULT_SURFACE },
    back: { ...DEFAULT_SURFACE },
  });

  const [showZones, setShowZones] = useState({ clear: true, address: true, return: true, imposed: true });
  const [snapping, setSnapping] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [interaction, setInteraction] = useState<Interaction>(null);

  const [savedDesigns, setSavedDesigns] = useState<SavedDesign[]>([]);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [operationMessage, setOperationMessage] = useState("No draft selected.");
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDesign, setLoadingDesign] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);

  const active = surfaces[activeSurface];
  const { widthIn, heightIn, pxPerInch } = CANVAS_SPECS[size];
  const validation = useMemo(() => buildValidation(surfaces, size), [surfaces, size]);

  const loadDesigns = useCallback(async () => {
    setLoadingDesigns(true);
    try {
      const response = await fetch("/api/ops/production/artwork");
      const payload = await response.json();
      if (!response.ok) {
        setOperationMessage(payload?.error ?? "Unable to load saved artworks");
        return;
      }
      const designs = Array.isArray((payload as SavedDesignListResponse).designs)
        ? (payload as SavedDesignListResponse).designs
        : [];
      setSavedDesigns(designs);
      setOperationMessage("Loaded draft list.");
    } catch (error) {
      setOperationMessage(error instanceof Error ? error.message : "Could not load draft list");
    } finally {
      setLoadingDesigns(false);
    }
  }, []);

  useEffect(() => {
    void loadDesigns();
  }, [loadDesigns]);

  const hydrateDesign = useCallback((design: SavedDesign) => {
    const front = fromPersistedSurface(design.front_state);
    const back = fromPersistedSurface(design.back_state);

    setSize(design.size);
    setSurfaces({ front, back });
    setActiveSurface("front");
    setSelectedIds([]);
    setInteraction(null);
    setDesignName(design.name);
    setActiveDesignId(design.id);
    setSelectedDesignId(design.id);
    setOperationMessage(`Loaded draft ${design.name}`);
  }, []);

  const loadDesign = useCallback(
    async (designId: string) => {
      if (!designId) return;
      setLoadingDesign(true);
      try {
        const response = await fetch(`/api/ops/production/artwork?id=${encodeURIComponent(designId)}`);
        const payload = (await response.json()) as SavedDesignResponse | { error?: string };
        if (!response.ok || !("design" in payload)) {
          const errorPayload = payload as { error?: string };
          setOperationMessage(errorPayload.error || "Unable to load that draft");
          return;
        }

        hydrateDesign(payload.design);
      } catch (error) {
        setOperationMessage(error instanceof Error ? error.message : "Unable to load that draft");
      } finally {
        setLoadingDesign(false);
      }
    },
    [hydrateDesign],
  );

  const addElement = useCallback(
    (kind: ElementKind) => {
      const id = `e-${Math.random().toString(36).slice(2, 9)}`;
      let next: ArtworkElement;

      if (kind === "text") {
        next = {
          id,
          kind,
          x: 0.7,
          y: 0.7,
          width: 2.4,
          height: 0.5,
          rotation: 0,
          text: "Your text here",
          fontSize: 14,
          fontFamily: FONT_FAMILIES[0].value,
          color: "#0f172a",
        };
      } else if (kind === "shape") {
        next = {
          id,
          kind,
          x: 1,
          y: 1,
          width: 1.5,
          height: 1,
          rotation: 0,
          fill: "#2563eb4d",
        };
      } else {
        const src = pickImageSource(active);
        if (!src) return;
        next = {
          id,
          kind,
          x: 0.8,
          y: 1.9,
          width: 2,
          height: 2,
          rotation: 0,
          src,
          fill: "#000000",
        };
      }

      setSurfaces((prev) => ({
        ...prev,
        [activeSurface]: {
          ...prev[activeSurface],
          elements: [...prev[activeSurface].elements, next],
        },
      }));
      setSelectedIds([id]);
    },
    [active, activeSurface],
  );

  const updateElement = useCallback(
    (updater: (el: ArtworkElement) => ArtworkElement) => {
      if (selectedIds.length === 0) return;
      setSurfaces((prev) => {
        const current = prev[activeSurface];
        return {
          ...prev,
          [activeSurface]: {
            ...current,
            elements: current.elements.map((el) => (selectedIds.includes(el.id) ? updater(el) : el)),
          },
        };
      });
    },
    [activeSurface, selectedIds],
  );

  const removeSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setSurfaces((prev) => {
      const current = prev[activeSurface];
      return {
        ...prev,
        [activeSurface]: {
          ...current,
          elements: current.elements.filter((el) => !selectedIds.includes(el.id)),
        },
      };
    });
    setSelectedIds([]);
    setInteraction(null);
  }, [activeSurface, selectedIds]);

  const moveLayer = useCallback((elementId: string, direction: "front" | "back") => {
    setSurfaces((prev) => {
      const current = prev[activeSurface];
      const index = current.elements.findIndex((el) => el.id === elementId);
      if (index === -1) return prev;

      const elements = [...current.elements];
      const nextIndex = direction === "front" ? Math.min(elements.length - 1, index + 1) : Math.max(0, index - 1);
      const [moved] = elements.splice(index, 1);
      elements.splice(nextIndex, 0, moved);

      return { ...prev, [activeSurface]: { ...current, elements } };
    });
  }, [activeSurface]);

  const replaceUpload = useCallback(
    async (slot: "logo" | "base", file: File | null) => {
      if (!file) return;

      if (slot === "logo" && !(file.type === "image/png" || file.type === "image/jpeg")) {
        setOperationMessage("Logo upload only accepts PNG or JPEG.");
        return;
      }

      if (slot === "base" && !(file.type === "image/png" || file.type === "image/jpeg" || file.type === "application/pdf")) {
        setOperationMessage("Base graphic upload only accepts PNG, JPEG, or PDF.");
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const meta = await probeImageMeta(file);

      setSurfaces((prev) => {
        const current = prev[activeSurface];
        const next = {
          ...current,
          ...(slot === "logo"
            ? {
                logoUrl: dataUrl,
                logoMeta: meta,
              }
            : {
                baseGraphicUrl: dataUrl,
                baseMeta: meta,
              }),
        };

        return { ...prev, [activeSurface]: next };
      });
      setOperationMessage(`${slot === "logo" ? "Logo" : "Base"} uploaded.`);
    },
    [activeSurface],
  );

  const onUploadFile = (slot: "logo" | "base") => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void replaceUpload(slot, file);
  };

  const onCanvasPointerMove = useCallback(
    (event: PointerEvent) => {
      if (!interaction || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const currentX = (event.clientX - rect.left) / pxPerInch;
      const currentY = (event.clientY - rect.top) / pxPerInch;

      const snap = snapping ? 0.125 : 0;

      setSurfaces((prev) => {
        const current = prev[interaction.surface];
        const updated = current.elements.map((el) => {
          if (el.id !== interaction.elementId) return el;

          if (interaction.kind === "move") {
            const nextX = interaction.startLeft + (currentX - interaction.startX);
            const nextY = interaction.startTop + (currentY - interaction.startY);

            const snappedX = snap > 0 ? Math.round(nextX / snap) * snap : nextX;
            const snappedY = snap > 0 ? Math.round(nextY / snap) * snap : nextY;

            return {
              ...el,
              x: Math.min(Math.max(0, snappedX), widthIn - el.width),
              y: Math.min(Math.max(0, snappedY), heightIn - el.height),
            };
          }

          const nextW = interaction.startWidth + (currentX - interaction.startX);
          const nextH = interaction.startHeight + (currentY - interaction.startY);
          const snappedW = snap > 0 ? Math.round(Math.max(0.125, nextW) / snap) * snap : Math.max(0.125, nextW);
          const snappedH = snap > 0 ? Math.round(Math.max(0.125, nextH) / snap) * snap : Math.max(0.125, nextH);

          return {
            ...el,
            width: Math.min(Math.max(0.125, snappedW), widthIn - el.x),
            height: Math.min(Math.max(0.125, snappedH), heightIn - el.y),
          };
        });

        return { ...prev, [interaction.surface]: { ...current, elements: updated } };
      });
    },
    [heightIn, interaction, pxPerInch, snapping, widthIn],
  );

  const onCanvasPointerUp = useCallback(() => {
    setInteraction(null);
  }, []);

  useEffect(() => {
    if (!interaction) return;

    window.addEventListener("pointermove", onCanvasPointerMove);
    window.addEventListener("pointerup", onCanvasPointerUp);

    return () => {
      window.removeEventListener("pointermove", onCanvasPointerMove);
      window.removeEventListener("pointerup", onCanvasPointerUp);
    };
  }, [interaction, onCanvasPointerMove, onCanvasPointerUp]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
          return;
        }
        removeSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeSelected]);

  const beginMove = (event: ReactPointerEvent<HTMLElement>, elementId: string) => {
    if (interaction) return;

    const el = active.elements.find((item) => item.id === elementId);
    if (!el) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = (event.clientX - rect.left) / pxPerInch;
    const startY = (event.clientY - rect.top) / pxPerInch;

    setSelectedIds((prev) => (event.shiftKey ? prev : [elementId]));

    setInteraction({
      kind: "move",
      elementId,
      surface: activeSurface,
      pointerId: event.pointerId,
      startX,
      startY,
      startLeft: el.x,
      startTop: el.y,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const beginResize = (event: ReactPointerEvent<HTMLElement>, elementId: string) => {
    if (interaction) return;

    const el = active.elements.find((item) => item.id === elementId);
    if (!el) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = (event.clientX - rect.left) / pxPerInch;
    const startY = (event.clientY - rect.top) / pxPerInch;
    setSelectedIds((prev) => (prev.includes(elementId) ? prev : [elementId]));

    setInteraction({
      kind: "resize",
      elementId,
      surface: activeSurface,
      pointerId: event.pointerId,
      startX,
      startY,
      startWidth: el.width,
      startHeight: el.height,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const toggleLayerSelection = (id: string, shift: boolean) => {
    setSelectedIds((prev) => {
      if (shift) {
        if (prev.includes(id)) return prev.filter((item) => item !== id);
        return [...prev, id];
      }
      return [id];
    });
  };

  const selectedElement = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return active.elements.find((el) => el.id === selectedIds[0]) ?? null;
  }, [active.elements, selectedIds]);

  const saveDesign = useCallback(async () => {
    setSaving(true);
    setOperationMessage("Saving draft...");

    const payload = {
      id: activeDesignId || undefined,
      size,
      name: designName.trim() || "Draft",
      validation: {
        status: validation.status,
        issues: validation.issues.map((issue) => issue.message),
      },
      front: toPersistedSurface(surfaces.front),
      back: toPersistedSurface(surfaces.back),
      phase1Document: toPhase1Document(size, surfaces.front, surfaces.back),
    } as const;

    try {
      const response = await fetch("/api/ops/production/artwork", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok || typeof json !== "object" || !json) {
        setOperationMessage((json as { error?: string })?.error ?? "Failed to save draft.");
        return;
      }
      const saved = (json as { design: SavedDesign }).design;
      if (!saved) {
        setOperationMessage("Could not parse saved draft response.");
        return;
      }

      setActiveDesignId(saved.id);
      setDesignName(saved.name);
      setOperationMessage(`Saved ${saved.name}.`);
      await loadDesigns();
    } finally {
      setSaving(false);
    }
  }, [activeDesignId, designName, loadDesigns, size, surfaces, validation]);

  const canAddImage = pickImageSource(active) !== null;
  const validationCount = validation.issues.length;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            Canvas size
            <select
              value={size}
              onChange={(event) => setSize(event.target.value as ArtSize)}
              className="rounded-md border border-border bg-background px-2 py-2 text-sm"
            >
              <option value="4x6">4x6</option>
              <option value="6x9">6x9</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm font-medium">
            Side
            <select
              value={activeSurface}
              onChange={(event) => setActiveSurface(event.target.value as Surface)}
              className="rounded-md border border-border bg-background px-2 py-2 text-sm"
            >
              <option value="front">Front</option>
              <option value="back">Back</option>
            </select>
          </label>

          <button
            type="button"
            onClick={() => addElement("text")}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Add text
          </button>
          <button
            type="button"
            onClick={() => addElement("shape")}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Add shape
          </button>
          <button
            type="button"
            onClick={() => addElement("image")}
            disabled={!canAddImage}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Add image
          </button>

          <label className="ml-auto text-sm font-medium">
            Design name
            <Input
              value={designName}
              onChange={(event) => setDesignName(event.target.value)}
              className="ml-2 inline-block w-44"
            />
          </label>

          <label className="text-sm font-medium">
            Logo
            <Input
              id="logo-upload"
              type="file"
              accept="image/png,image/jpeg"
              onChange={onUploadFile("logo")}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => document.getElementById("logo-upload")?.click()}
              className="ml-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              Upload
            </button>
          </label>

          <label className="text-sm font-medium">
            Base graphic
            <Input
              id="base-upload"
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              onChange={onUploadFile("base")}
              className="sr-only"
            />
            <button
              type="button"
              onClick={() => document.getElementById("base-upload")?.click()}
              className="ml-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              Upload
            </button>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={saveDesign}
            disabled={saving || validation.status === "blocked"}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save draft"}
          </button>
          <label className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">Saved draft</span>
            <select
              value={selectedDesignId}
              onChange={(event) => setSelectedDesignId(event.target.value)}
              className="rounded-md border border-border bg-background px-2 py-2 text-sm"
            >
              <option value="">Select one</option>
              {savedDesigns.map((design) => (
                <option key={design.id} value={design.id}>
                  {design.name} · {design.size} · {new Date(design.updated_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void loadDesign(selectedDesignId)}
            disabled={!selectedDesignId || loadingDesigns}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            {loadingDesign ? "Loading..." : "Load draft"}
          </button>
          <button
            type="button"
            onClick={() => void loadDesigns()}
            className="rounded-md border border-border px-3 py-2 text-sm"
            disabled={loadingDesigns}
          >
            {loadingDesigns ? "Refreshing..." : "Refresh list"}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showZones.clear}
              onChange={(event) => setShowZones((prev) => ({ ...prev, clear: event.target.checked }))}
            />
            Show clear zone
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showZones.address}
              onChange={(event) => setShowZones((prev) => ({ ...prev, address: event.target.checked }))}
            />
            Show address/IMB zone
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showZones.return}
              onChange={(event) => setShowZones((prev) => ({ ...prev, return: event.target.checked }))}
            />
            Show return zone
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={showZones.imposed}
              onChange={(event) => setShowZones((prev) => ({ ...prev, imposed: event.target.checked }))}
            />
            Show indicia zone
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={snapping}
              onChange={(event) => setSnapping(event.target.checked)}
            />
            Snap to quarter-inch
          </label>
        </div>

        <p
          className={`mt-2 rounded-md px-3 py-2 text-xs ${
            validation.status === "pass"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : validation.status === "warn"
                ? "border border-amber-300 bg-amber-50 text-amber-900"
                : "border border-red-300 bg-red-50 text-red-900"
          }`}
        >
          Validation status: <span className="font-semibold uppercase">{validation.status}</span>
          {validationCount > 0 ? ` (${validationCount} issue${validationCount === 1 ? "" : "s"})` : ""}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{operationMessage}</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <div>
          <div
            ref={canvasRef}
            className="relative overflow-hidden rounded-lg border border-border bg-white"
            style={{ width: widthIn * pxPerInch, height: heightIn * pxPerInch }}
          >
            {showZones.clear &&
              ZONES[size]
                .filter((zone) => zone.kind === "clear")
                .map((zone) => {
                  const rect = toClientRectPx(zone.rect, pxPerInch);
                  return (
                    <div
                      key={zone.label}
                      className="pointer-events-none absolute border border-dashed border-amber-600/80 bg-amber-100/25"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })}

            {showZones.address &&
              ZONES[size]
                .filter((zone) => zone.kind === "address")
                .map((zone) => {
                  const rect = toClientRectPx(zone.rect, pxPerInch);
                  return (
                    <div
                      key={zone.label}
                      className="pointer-events-none absolute border border-dotted border-red-700/70 bg-red-100/20"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })}

            {showZones.return &&
              ZONES[size]
                .filter((zone) => zone.kind === "return")
                .map((zone) => {
                  const rect = toClientRectPx(zone.rect, pxPerInch);
                  return (
                    <div
                      key={zone.label}
                      className="pointer-events-none absolute border border-dotted border-sky-600/70 bg-sky-100/20"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })}

            {showZones.imposed &&
              ZONES[size]
                .filter((zone) => zone.kind === "imposed")
                .map((zone) => {
                  const rect = toClientRectPx(zone.rect, pxPerInch);
                  return (
                    <div
                      key={zone.label}
                      className="pointer-events-none absolute border border-dotted border-violet-700/70 bg-violet-100/20"
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                      }}
                    />
                  );
                })}

            {active.baseGraphicUrl ? (
              isDataUrlImage(active.baseGraphicUrl) ? (
                <img
                  src={active.baseGraphicUrl}
                  alt="Base graphic"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100 text-xs text-slate-600">
                  PDF base graphic loaded
                </div>
              )
            ) : null}

            {active.elements.map((el) => {
              const isSelected = selectedIds.includes(el.id);
              const rect = toClientRectPx(el, pxPerInch);

              return (
                <div
                  key={el.id}
                  role="button"
                  tabIndex={0}
                  className={`absolute cursor-pointer border ${
                    isSelected ? "border-emerald-500" : "border-transparent"
                  }`}
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    transform: `rotate(${el.rotation}deg)`,
                    background: el.kind === "shape" ? el.fill ?? "#2563eb4d" : "transparent",
                    borderWidth: el.kind === "shape" ? 1 : 0,
                    color: el.color,
                    fontSize: el.fontSize,
                    fontFamily: el.fontFamily,
                  }}
                  onPointerDown={(event) => {
                    if ((event.target as HTMLElement).dataset.handle === "resize") {
                      return;
                    }
                    toggleLayerSelection(el.id, event.shiftKey);
                    beginMove(event, el.id);
                  }}
                >
                  {el.kind === "text" && <div className="h-full w-full p-1">{el.text}</div>}
                  {el.kind === "image" && el.src ? (
                    <img src={el.src} alt="Layer element" className="h-full w-full object-contain" />
                  ) : null}

                  {isSelected ? (
                    <button
                      type="button"
                      data-handle="resize"
                      onPointerDown={(event) => beginResize(event, el.id)}
                      className="absolute -right-2 -bottom-2 h-4 w-4 bg-emerald-500"
                      title="Resize"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={removeSelected}
              disabled={selectedIds.length === 0}
              className="rounded-md border border-destructive px-3 py-2 text-sm disabled:opacity-50"
            >
              Delete selected
            </button>
          </div>
          <ul className="mt-2 max-h-40 overflow-auto rounded border border-border bg-muted/40 p-2 text-sm text-muted-foreground">
            {validation.issues.length === 0 ? (
              <li className="list-disc px-4 py-1 text-emerald-700">No validation issues.</li>
            ) : (
              validation.issues.map((issue, index) => (
                <li key={`${issue.message}-${index}`} className="list-disc px-4 py-1">
                  <span
                    className={
                      issue.level === "blocked" ? "font-semibold text-red-700" : "text-amber-700"
                    }
                  >
                    {issue.level === "blocked" ? "[Blocked] " : "[Warning] "}
                  </span>
                  {issue.message}
                </li>
              ))
            )}
          </ul>
        </div>

        <aside className="space-y-3">
          <div className="rounded-lg border border-border p-4">
            <h2 className="font-heading text-sm font-semibold">Layers</h2>
            <div className="mt-2 space-y-2">
              {active.elements.length === 0 ? (
                <p className="text-sm text-muted-foreground">No layers yet.</p>
              ) : (
                active.elements.map((el, index) => {
                  const isSelected = selectedIds.includes(el.id);
                  return (
                    <div
                      key={el.id}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 ${
                        isSelected ? "border-emerald-500 bg-emerald-50" : "border-border"
                      }`}
                      onClick={() => toggleLayerSelection(el.id, false)}
                    >
                      <span className="truncate text-sm">{elementLabel(el)}</span>
                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveLayer(el.id, "back");
                          }}
                          className="rounded border px-2 py-0.5 text-xs"
                          title="Send backward"
                        >
                          -
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveLayer(el.id, "front");
                          }}
                          className="rounded border px-2 py-0.5 text-xs"
                          title="Bring forward"
                        >
                          +
                        </button>
                      </span>
                      <span className="text-xs text-muted-foreground">{index}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h2 className="font-heading text-sm font-semibold">Properties</h2>
            {selectedElement ? (
              <div className="mt-2 space-y-2 text-sm">
                <Label htmlFor="selected-x">X (in)</Label>
                <Input
                  id="selected-x"
                  type="number"
                  step="0.05"
                  value={selectedElement.x}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateElement((el) => ({ ...el, x: Number.isFinite(value) ? value : el.x }));
                  }}
                />

                <Label htmlFor="selected-y">Y (in)</Label>
                <Input
                  id="selected-y"
                  type="number"
                  step="0.05"
                  value={selectedElement.y}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateElement((el) => ({ ...el, y: Number.isFinite(value) ? value : el.y }));
                  }}
                />

                <Label htmlFor="selected-width">Width (in)</Label>
                <Input
                  id="selected-width"
                  type="number"
                  step="0.05"
                  value={selectedElement.width}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateElement((el) => ({ ...el, width: Number.isFinite(value) && value > 0 ? value : el.width }));
                  }}
                />

                <Label htmlFor="selected-height">Height (in)</Label>
                <Input
                  id="selected-height"
                  type="number"
                  step="0.05"
                  value={selectedElement.height}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateElement((el) => ({
                      ...el,
                      height: Number.isFinite(value) && value > 0 ? value : el.height,
                    }));
                  }}
                />

                <Label htmlFor="selected-rotation">Rotation (deg)</Label>
                <Input
                  id="selected-rotation"
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={selectedElement.rotation}
                  onChange={(event) => {
                    const value = Number.parseFloat(event.target.value);
                    updateElement((el) => ({ ...el, rotation: Number.isFinite(value) ? value : el.rotation }));
                  }}
                />

                {selectedElement.kind === "text" ? (
                  <>
                    <Label htmlFor="selected-text">Text</Label>
                    <Input
                      id="selected-text"
                      value={selectedElement.text ?? ""}
                      onChange={(event) => {
                        updateElement((el) => ({
                          ...el,
                          text: event.target.value,
                        }));
                      }}
                    />
                    <Label htmlFor="selected-font">Font</Label>
                    <select
                      id="selected-font"
                      value={selectedElement.fontFamily ?? FONT_FAMILIES[0].value}
                      onChange={(event) => {
                        updateElement((el) => ({ ...el, fontFamily: event.target.value }));
                      }}
                      className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                    >
                      {FONT_FAMILIES.map((font) => (
                        <option key={font.value} value={font.value}>
                          {font.label}
                        </option>
                      ))}
                    </select>
                  </>
                ) : null}

                <button
                  type="button"
                  onClick={removeSelected}
                  className="mt-2 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground"
                >
                  Delete
                </button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Select one layer to edit details.</p>
            )}
          </div>
        </aside>
      </section>

      <p className="text-xs text-muted-foreground">
        This page surfaces: upload logo + base graphic (PNG/JPEG + PDF for base), move/resize/rotate text/image/shape,
        z-order control, layer list, snapping, clear/address/return/imposed toggles, and validation by clear-zone,
        low-resolution logo, and DPI.
      </p>
    </div>
  );
}
