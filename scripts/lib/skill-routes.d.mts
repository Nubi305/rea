export interface ForkCorrection {
  readonly section: string;
  readonly reason: string;
  readonly find: string;
  readonly replace: string;
}

export declare const ROUTE_REFERENCES: Readonly<{
  routes: string;
  formats: string;
  working: string;
}>;

export declare const FORK_CORRECTIONS: readonly ForkCorrection[];

export interface ForkKeywords {
  readonly section: string;
  readonly reason: string;
  readonly keywords: string;
}

export declare const FORK_KEYWORDS: readonly ForkKeywords[];

export declare const skillSections: (text: string) => {
  readonly preamble: string;
  readonly sections: { heading: string; text: string }[];
};

export declare const portSkillRoutes: (upstreamSkill: string) => {
  readonly files: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
};
