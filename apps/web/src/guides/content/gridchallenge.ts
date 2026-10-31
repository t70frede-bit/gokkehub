import type { GameGuide } from "../types";
import { JoinScene, TwoTeams } from "../scenes/shared";
import { ClaimScene, GridBoardScene, LibraryScene, VersusScene } from "../scenes/gridchallenge";

export const gridchallengeGuide: GameGuide = {
  players: "2–4 teams",
  time:    "A gaming session",
  needs:   "Games your group owns",
  intro:
    "Grid Challenge is team bingo for gamers. Every square on the board is a challenge in a game you all play, like \"Win a game without dying\" in League of Legends. Pull it off, claim the square for your team, and race the other teams to five in a row.",
  hero: {
    Component: GridBoardScene,
    label: "A 5 by 5 board fills with blue and red claims until Blue completes a diagonal and gets BINGO.",
  },

  goal: {
    summary: "Be the first team to claim a full line of squares: across, down or diagonally.",
    points: [
      "Every square is an in-game challenge.",
      "Complete it, then claim it for your team.",
      "Five in a row wins on the standard 5×5 board. The host can change both the board size and the line length.",
    ],
    scene: {
      Component: GridBoardScene,
      label: "Claims appear on a 5 by 5 board for Blue and Red. Blue's diagonal lights up: BINGO.",
    },
  },

  setup: [
    {
      title: "The host opens a lobby",
      body: "Go to partybingo.gokkehub.com and host a game. You can play on a team yourself, or run the game as game master without a team.",
    },
    {
      title: "Everyone joins and picks a team",
      body: "Share the lobby code or link. Players join from any browser and pick a team, or the host shuffles teams at random. Play with 2 to 4 teams.",
      scene: { Component: JoinScene, label: "A phone types the code and taps Continue. The player appears in the lobby list." },
    },
    {
      title: "Choose which games to play",
      body: "The lobby lists the games your players own. Sign in and link Steam to pull in your library automatically, or add games by hand. The host ticks the games for tonight and gets a warning if a team doesn't own one of them.",
      scene: { Component: LibraryScene, label: "Players' games are listed with who owns them. Steam syncs, and the host ticks League of Legends and Counter-Strike 2. The board is shuffled from their challenges.", height: 200 },
    },
    {
      title: "Tune the board, then start",
      body: "Pick the board size (3 to 9 squares each way), how many in a row wins, how many versus squares to include and how often they unlock, and whether to add a free middle square. Add your own challenges too, if you like. Then start and everyone gets the same shuffled board.",
    },
  ],

  play: [
    {
      title: "Go play your games",
      body: "Everyone jumps into the games on the board and hunts for challenges they can pull off. 👤 Single challenges are for one player, and 👥 Group challenges need the team to do it together.",
      scene: { Component: TwoTeams, label: "Players split into a blue and a red team.", height: 170 },
    },
    {
      title: "Claim the square",
      body: "Done it? Tap the square and it turns your team's colour for everyone, with a ping and a note in the claim log. Claimed by mistake? Tap it again to undo.",
      scene: { Component: ClaimScene, label: "A challenge square reads: Win a game without dying, League of Legends. Maja taps it and it turns blue with her name." },
      tip: "It's on the honour system, so play fair. The host can undo any claim.",
    },
    {
      title: "Race for the versus squares",
      body: "⚔️ Versus squares start locked. A timer unlocks one every few minutes, and then the teams go head to head. The first team to win it takes the square. Players can vote to skip the wait.",
      scene: { Component: VersusScene, label: "A locked square counts down from three seconds, unlocks as a versus challenge, and Red wins it and claims the square." },
    },
    {
      title: "Block and build",
      body: "Keep an eye on the board. Grabbing a square in the other team's line blocks them, and every claim you make is a step toward your own line.",
    },
  ],

  winning: {
    summary: "The moment a team owns a full line, the board shouts BINGO and that team wins.",
    points: [
      "Lines count across, down and both diagonals.",
      "With a free middle square, it counts for every team.",
    ],
  },

  modes: {
    heading: "Kinds of challenges",
    items: [
      { icon: "👤", title: "Single", body: "One player does it alone, like \"Get 30+ kills\"." },
      { icon: "👥", title: "Group", body: "The team does it together in the same match." },
      { icon: "⚔️", title: "Versus", body: "Locked until the timer unlocks it, then the teams race for it head to head." },
    ],
  },

  faq: [
    {
      q: "Where do the challenges come from?",
      a: "There's a built-in set for popular games, and players can write their own. The host chooses standard challenges, custom ones, or a mix.",
    },
    {
      q: "Do we all need to own the same games?",
      a: "No. The lobby shows who owns each game and warns the host if a team has nobody who owns one of the picked games.",
    },
    {
      q: "Can I play on my own?",
      a: "Yes. Pick solo on the start page to generate a board just for you. Click a square to mark it blue, or right-click to mark it red.",
    },
    {
      q: "We're streaming. Anything to know?",
      a: "Turn on streamer mode in the lobby settings, and hide the spectator list if you like.",
    },
  ],
};
