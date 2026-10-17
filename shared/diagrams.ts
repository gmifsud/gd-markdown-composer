// Contract for /api/diagrams/*.

export interface DiagramStatus {
  plantuml: { available: boolean; reason?: string };
}

export interface PlantUmlRenderResponse {
  /** SVG markup; PlantUML also draws an error image for invalid diagrams. */
  svg: string | null;
  /** Set when PlantUML reported a problem. */
  error?: string;
}
