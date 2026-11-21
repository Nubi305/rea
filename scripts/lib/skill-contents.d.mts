export declare const CONTENTS_MIN_LINES: number;
export declare const CONTENTS_LABEL: string;

export declare const contentsHeadings: (
  text: string,
) => { readonly level: number; readonly title: string }[];

export declare const localizeLinks: (text: string) => string;

export declare const packagedSkillFile: (
  relativePath: string,
  authored: string,
) => string;
