export type ArtifactKey =
  | {
      project: string;
      type: "tag";
      tag: string;
    }
  | {
      project: string;
      type: "id";
      id: string;
    };

export type ResolvedArtifactKey = {
  project: string;
  id: string;
};
