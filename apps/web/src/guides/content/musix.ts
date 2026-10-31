import type { GameGuide } from "../types";
import { JoinScene, TwoTeamsWithCaptains } from "../scenes/shared";
import {
  GuessScene, MusicBingoScene, MusixGoalScene, PushLuckScene,
  SongSourceScene, TimelineDropScene,
} from "../scenes/musix";

export const musixGuide: GameGuide = {
  players: "2 teams",
  time:    "20–40 min",
  needs:   "A host with Spotify",
  intro:
    "Musix is a music timeline game built around your group's actual taste. A song plays and your team slots it onto your timeline in the year you think it came out. Keep going to build a bigger run, but one wrong guess and the cards you've stacked up this turn are gone. Name the artist and title too and you earn power-up tokens to bend the rules.",
  hero: {
    Component: TimelineDropScene,
    label: "A mystery song card slides along a timeline of 1984, 2003 and 2016 and drops into the gap after 1984. It flips to reveal 1991, which is correct.",
  },

  goal: {
    summary: "Be the first team to build a timeline with the target number of cards, every one of them in the right order by release year.",
    points: [
      "Every song is a card with a hidden release year.",
      "Place it in the right spot between the cards you already have.",
      "The host picks the target: 5, 7, 10, 12 or 15 cards.",
    ],
    scene: {
      Component: MusixGoalScene,
      label: "Two team timelines fill up card by card. Team 1 reaches 10 out of 10 cards and wins.",
      height: 180,
    },
  },

  setup: [
    {
      title: "The host opens a room",
      body: "Go to musix.gokkehub.com and host a game. You get a 4-letter room code to share with everyone.",
    },
    {
      title: "Everyone joins from their phone",
      body: "Players type the code at gokkehub.com/join. No app to install, and players don't need an account.",
      scene: { Component: JoinScene, label: "A phone types the room code GOKK and taps Continue. The player appears in the lobby list." },
    },
    {
      title: "Split into two teams",
      body: "Players pick a side in the lobby. Each team has a captain, who places the cards and makes the calls for the team.",
      scene: { Component: TwoTeamsWithCaptains, label: "Players slide into Team 1 and Team 2, and one player becomes captain.", height: 180 },
    },
    {
      title: "Pick where the songs come from",
      body: "Build the song pool from what your group actually listens to, from your Spotify accounts, or paste any Spotify playlist for a theme night. Set the difficulty and the number of cards to win, then start.",
      scene: { Component: SongSourceScene, label: "The three song sources light up one at a time: Group taste, Spotify taste, and Playlist.", height: 200 },
    },
  ],

  play: [
    {
      title: "Listen to the mystery song",
      body: "Each team starts with one card on its timeline. On your turn a song plays, and your team talks it over: is it older or newer than what you've got?",
    },
    {
      title: "Drop it where it belongs",
      body: "The captain slides the song into a gap on the timeline and confirms. Then the year is revealed. If it fits between its neighbours, it's right.",
      scene: { Component: TimelineDropScene, label: "A mystery card hovers over two gaps, drops between 1984 and 2003 and flips to 1991, which is correct." },
    },
    {
      title: "Push your luck, or lock it in",
      body: "A correct card goes on your pending pile, and you choose: lock in now to keep everything, or take another song. If you place one wrong, every pending card from this turn is lost.",
      scene: { Component: PushLuckScene, label: "Two correct cards pile up as pending. Locking in keeps them all. In the second run, a third card is wrong and the two pending cards are lost." },
      tip: "Already one or two cards from the target? It's often worth locking in.",
    },
    {
      title: "Name it for a bonus",
      body: "The captain can also guess the artist and the song title. Get both right and your team earns a power-up token to use on a later turn.",
      scene: { Component: GuessScene, label: "The captain types Nirvana and Smells Like Teen Spirit. Both are marked correct and a token pops out." },
    },
    {
      title: "Pass the turn",
      body: "When you lock in or miss, it's the other team's turn. Tokens, steals and counters mean nothing is safe until the last card.",
    },
  ],

  winning: {
    summary: "The first team to reach the target number of locked cards wins.",
    points: [
      "Cards only count once they're locked in, so a lucky streak you don't lock can still slip away.",
      "With the tie-breaker win rule, the other team gets one more turn to answer back when someone crosses the line.",
    ],
  },

  modes: {
    heading: "Ways to play",
    items: [
      {
        icon: "🎧",
        title: "Your group's taste",
        body: "Songs are picked from what your players actually listen to, so the timeline is full of tracks you'll recognise and argue about.",
      },
      {
        icon: "📃",
        title: "Any Spotify playlist",
        body: "Paste a playlist link and Musix plays from that pool. Great for a decades night or a shared party mix.",
      },
      {
        icon: "⚖️",
        title: "You decide who judges",
        body: "The team's own captain, the next team's captain, the host, or a vote of everyone settles whether a typed guess counts. Or switch to search mode, where the guess is checked automatically.",
      },
      {
        icon: "🔤",
        title: "Music Bingo",
        body: "A second game in the same room. Each team gets a board of words from song titles and artists. Hear a song with a word on your board? Teammates suggest it and the captain crosses it off. First to complete a line wins.",
        scene: {
          Component: MusicBingoScene,
          label: "A bingo board of words. As songs play, a teammate suggests a word and the captain crosses it off, until a whole row is complete and it says BINGO.",
        },
      },
    ],
  },

  extras: {
    heading: "Power-up tokens",
    intro: "Earn these by naming the artist and the title, then spend them to bend a round your way. The host can also run a shop where every right guess earns points to buy tokens.",
    items: [
      { icon: "🖼️", name: "Cover Reveal", desc: "Peek at the album art for a hint." },
      { icon: "±5", name: "+/- 5 Years", desc: "Widen your placement window for one drop." },
      { icon: "⏭️", name: "Song Skipper", desc: "Skip a song you have no clue about." },
      { icon: "🎯", name: "Steal by Year", desc: "Pounce on a rival's missed placement." },
      { icon: "↩️", name: "Token Counter", desc: "Cancel an opponent's power-up as it happens." },
      { icon: "🛟", name: "Recovery", desc: "Save one card from a botched turn." },
    ],
  },

  faq: [
    {
      q: "Do all players need Spotify?",
      a: "No. Only the host needs Spotify so the room can play audio. Everyone else just joins with the room code.",
    },
    {
      q: "How do we all hear the song?",
      a: "Audio plays on the host's device by default. Playing remotely? Use the Musix Discord bot in your voice channel, or let everyone stream the song on their own phone.",
    },
    {
      q: "How does Music Bingo work?",
      a: "Pick Bingo as the game mode in the lobby. Each square is a word from a song title or artist, so LOVE also matches Loving and Loved. The host chooses how strictly ticks are checked and whether you need one line, two lines or a full board.",
    },
    {
      q: "How many people can play?",
      a: "It's always two teams, so it scales from a couple of friends to a packed room.",
    },
  ],
};
