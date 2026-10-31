import type { GameGuide } from "../types";
import { JoinScene } from "../scenes/shared";
import {
  AnswerModesScene, BuzzerScene, FinalScene, JeopardyBoardScene,
  JeopardySetupScene, PowerupScene, ScoringScene,
} from "../scenes/jeopardy";

export const jeopardyGuide: GameGuide = {
  players: "Solo or 2–8 teams",
  time:    "30–60 min",
  needs:   "A big screen + phones",
  intro:
    "Build your own Jeopardy board with your own categories, pictures, sound and video, then host it live. The board goes up on a TV, players buzz in from their phones, and hidden power-ups can swing the scores right up to Final Jeopardy.",
  hero: {
    Component: JeopardyBoardScene,
    label: "A Jeopardy board with five categories on a TV. A 300 tile in Space is picked, opens into the question, and Team Blue buzzes in.",
  },

  goal: {
    summary: "Finish with the most points. Pick tiles, buzz in first, and answer right. A wrong answer costs you the same amount.",
    points: [
      "Every tile is a question worth its value. Higher rows are harder and worth more.",
      "Right answers add the value to your score. Wrong answers take it away.",
      "Whoever answers right picks the next tile.",
    ],
    scene: {
      Component: ScoringScene,
      label: "The host taps right for Blue, whose score goes from 400 to 700. Then the host taps wrong for Red, whose score drops from 400 to 100.",
    },
  },

  setup: [
    {
      title: "Build your board",
      body: "Sign in at jeopardy.gokkehub.com and create a game. Name your categories and fill in the tiles. A question can be text, an image, an audio clip or a video. Invite friends to help write it, if you like.",
    },
    {
      title: "Choose your rules",
      body: "Play solo, where everyone is on their own, or in 2 to 8 teams. Turn on extras such as a second board with double points, hidden power-ups, dangerous tiles and Final Jeopardy.",
    },
    {
      title: "Launch it and put it on the big screen",
      body: "Launch the game to open a room. Show the big-screen view on a TV or a shared screen, and keep the host controls on your phone.",
      scene: { Component: JeopardySetupScene, label: "Three kinds of screen light up in turn: the big screen with the board, the host's phone with right and wrong buttons, and a buzzer phone for each player.", height: 200 },
    },
    {
      title: "Players join with the room code",
      body: "Everyone joins at gokkehub.com/join and gets a buzzer on their phone. In team games, each team has a captain.",
      scene: { Component: JoinScene, label: "A phone types the room code and taps Continue. The player appears in the lobby list." },
    },
  ],

  play: [
    {
      title: "Pick a tile",
      body: "The team that has the board picks a category and a value, and the question opens on the big screen.",
      scene: { Component: JeopardyBoardScene, label: "The Space 300 tile lights up and opens into: This planet has the most moons in our solar system." },
    },
    {
      title: "Race to buzz in",
      body: "Buzzers go live once the question has been read. Hit yours first and you answer. The server decides who was fastest, so there's no arguing.",
      scene: { Component: BuzzerScene, label: "Three phones wait during reading time. The buzzers go live, Blue taps first and wins the buzz, and the other buzzers lock out.", height: 240 },
      tip: "Depending on the rules, a wrong answer can lock your team out or reopen the buzzers for everyone else.",
    },
    {
      title: "Answer out loud, and the host judges",
      body: "Say your answer. The host taps right or wrong. Right adds the tile's value and gives you the board. Wrong subtracts it.",
    },
    {
      title: "Some questions are answered on your phone",
      body: "Multiple choice, closest number and ranking questions appear on your phone instead of the buzzer. In team games the captain locks in the answer, and points go to whoever is right, or closest.",
      scene: { Component: AnswerModesScene, label: "A phone shows three kinds of question in turn: picking Saturn in multiple choice, sliding to 8,700 metres for closest number, and dragging mountains into the right order for ranking.", height: 220 },
    },
    {
      title: "Watch out for hidden tiles",
      body: "Some tiles hide a power-up. Answer one right and choose: keep the points or take the power-up. A 💥 Buzzed tile is dangerous: whoever picked it has to answer it alone.",
      scene: { Component: PowerupScene, label: "A 400 tile flips to reveal a power-up. Blue answered right and chooses Sniper instead of the 400 points, so they now buzz with a head start." },
    },
  ],

  winning: {
    summary: "When the board is cleared, the team with the most points wins. If Final Jeopardy is on, there's one last question first.",
    points: [
      "Final Jeopardy: every team wagers up to its current score before the question is shown.",
      "Answers are locked in secret on the phones, then the host reveals them one team at a time.",
      "Right adds the wager, wrong takes it away. Then the podium goes up.",
    ],
    scene: {
      Component: FinalScene,
      label: "Blue with 1800 wagers 1000 and Red with 1500 wagers 1500. Both lock in answers. Blue is right and ends on 2800. Red is wrong and drops to 0.",
      height: 200,
    },
  },

  extras: {
    heading: "Power-ups",
    intro: "Hidden on the board when the host turns them on. Answer the tile right and you can take one instead of the points. A team holds one power-up at a time.",
    items: [
      { icon: "⚡", name: "Sniper", desc: "A permanent head start when you buzz." },
      { icon: "🛡️", name: "Buffer", desc: "Lose less on every wrong answer." },
      { icon: "🎯", name: "Second Chance", desc: "Two tries per buzz. A second miss costs double." },
    ],
  },

  faq: [
    {
      q: "Do players need an account?",
      a: "No. Only the person building the board signs in. Players just join with the room code.",
    },
    {
      q: "Can we play without a TV?",
      a: "Yes. Any screen everyone can see works, like a laptop or a shared screen on a video call.",
    },
    {
      q: "Can I reuse a board?",
      a: "Yes. Your games stay on your dashboard, so you can host the same board again or tweak it first.",
    },
  ],
};
