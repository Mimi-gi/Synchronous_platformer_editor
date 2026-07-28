export type Rgb = {
  r: number;
  g: number;
  b: number;
};

export function hexToRgb(hex: string): Rgb {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/** Linear interpolation between two colors. `t` in [0, 1]. */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Mixes a color toward its perceived gray. `amount` in [0, 1]. */
export function desaturateRgb(color: Rgb, amount: number): Rgb {
  const luma = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return mixRgb(color, { r: luma, g: luma, b: luma }, amount);
}

/** Fallback identity color for layers loaded from projects predating layer colors. */
export const DEFAULT_LAYER_COLOR = "#8aa0b4";

export type TileAppearance = { r: number; g: number; b: number; a: number };

/**
 * How "Layer focus" should treat a layer: non-active layers are faded and
 * desaturated, and every layer is tinted toward its identity color. Renderers
 * apply this to both flat-color tiles and sprite tiles so the two look
 * consistent. When `layerFocus` is off this is the identity (no change).
 */
export type LayerFocusStyle = {
  /** Multiplies the layer opacity. */
  alpha: number;
  /** Desaturation amount toward gray, 0..1. */
  desaturate: number;
  /** Identity color to blend toward. */
  tint: Rgb;
  /** How strongly to blend toward `tint`, 0..1. */
  tintAmount: number;
};

export function layerFocusStyle(params: {
  layerColor: string | undefined;
  isActiveLayer: boolean;
  layerFocus: boolean;
}): LayerFocusStyle {
  const tint = hexToRgb(params.layerColor ?? DEFAULT_LAYER_COLOR);
  if (!params.layerFocus) {
    return { alpha: 1, desaturate: 0, tint, tintAmount: 0 };
  }
  if (params.isActiveLayer) {
    return { alpha: 1, desaturate: 0, tint, tintAmount: 0.28 };
  }
  return { alpha: 0.4, desaturate: 0.7, tint, tintAmount: 0.5 };
}

/**
 * Resolves how a flat-color tile cell should be drawn under "Layer focus".
 */
export function tileAppearance(params: {
  cellColor: string;
  layerColor: string | undefined;
  layerOpacity: number;
  isActiveLayer: boolean;
  layerFocus: boolean;
}): TileAppearance {
  const style = layerFocusStyle(params);
  let rgb = hexToRgb(params.cellColor);
  if (style.desaturate > 0) rgb = desaturateRgb(rgb, style.desaturate);
  if (style.tintAmount > 0) rgb = mixRgb(rgb, style.tint, style.tintAmount);
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: params.layerOpacity * style.alpha };
}
