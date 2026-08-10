declare module "gpxparser" {
  export default class GpxParser {
    xmlData: string;
    tracks: Array<Record<string, any>>;
    metadata: Record<string, any>;
    parse(gpxString: string): void;
  }
}
