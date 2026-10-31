import type { ComponentType } from "react";

/** An animated scene. Rendered inside a <Stage>, so it can call useBeat(). */
export interface GuideScene {
  Component: ComponentType;
  /** What the animation shows, in plain words — used as the alt text. */
  label:     string;
  height?:   number;
}

export interface GuideStep {
  title: string;
  body:  string;
  scene?: GuideScene;
  /** Optional short tip shown under the body. */
  tip?:  string;
}

/**
 * Long-form how-to-play guide for one game, rendered at /games/<slug>.
 * Every live game on the hub has one; they all share this shape so the pages
 * read the same way: goal → setup → how to play → winning → extras → FAQ.
 */
export interface GameGuide {
  /** Quick-fact chips at the top of the page. */
  players: string;
  time:    string;
  needs:   string;
  /** Lead paragraph under the title. */
  intro:   string;
  hero:    GuideScene;

  goal: {
    summary: string;
    points:  string[];
    scene:   GuideScene;
  };
  setup: GuideStep[];
  play:  GuideStep[];
  winning: {
    summary: string;
    points?: string[];
    scene?:  GuideScene;
  };

  /** Optional "modes / variants" cards. */
  modes?: {
    heading: string;
    intro?:  string;
    items:   { icon: string; title: string; body: string; scene?: GuideScene }[];
  };
  /** Optional power-up / feature chips. */
  extras?: {
    heading: string;
    intro?:  string;
    items:   { icon: string; name: string; desc: string }[];
  };
  faq: { q: string; a: string }[];
}
