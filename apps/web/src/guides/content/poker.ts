import type { GameGuide } from "../types";
import {
  BountyScene, BuyInCashOutScene, GroupScene, LeaderboardScene,
  PokerTableScene, TopUpScene,
} from "../scenes/poker";

export const pokerGuide: GameGuide = {
  players: "Your poker group",
  time:    "One home game",
  needs:   "Cards, chips and phones",
  intro:
    "Poker is the bank for your home game. You still play with real cards and chips. The app keeps track of who bought in, who cashed out and who's up over the season, and settles the money through your group's payment app.",
  hero: {
    Component: PokerTableScene,
    label: "Four players buy in around a table. The total on the table grows, and at the end each player's result appears: plus 160, minus 110, plus 50, minus 100.",
    height: 200,
  },

  goal: {
    summary: "Leave the table with more chips than you brought, and climb your group's leaderboard night after night.",
    points: [
      "You play poker as usual at the table.",
      "The app tracks every buy-in, rebuy and cash-out, so nobody keeps score on a napkin.",
      "Your results add up on the group's leaderboard.",
    ],
    scene: {
      Component: LeaderboardScene,
      label: "A leaderboard of four players reorders as results come in. Anders climbs to the top with plus 310 kr.",
      height: 160,
    },
  },

  setup: [
    {
      title: "Start or join a group",
      body: "Sign in at poker.gokkehub.com. One person creates the group and picks how money is paid (MobilePay Box, Swish, Vipps, PayPal, Revolut or bank), and how people join: by invite link, by asking an admin, or with a name and passcode.",
      scene: { Component: GroupScene, label: "The group admin copies an invite link and three friends join the group." },
    },
    {
      title: "Top up your balance",
      body: "Pick an amount and pay it through the group's payment app, with the tracking code the app gives you. Once the house confirms the payment, the money shows up in your balance.",
      scene: { Component: TopUpScene, label: "A player requests 200 kr, pays with tracking code K7Q2, and once the house confirms, the balance goes from 0 to 200 kr." },
      tip: "Add the app to your home screen. It's built for phones.",
    },
    {
      title: "Host a game",
      body: "Anyone in the group can host. Choose a cash game, with a buy-in range and optional rebuys, or a tournament, with a fixed buy-in and a mystery bounty.",
    },
  ],

  play: [
    {
      title: "Buy in from your balance",
      body: "Open the game and buy in. The amount moves from your balance onto the table, and you take the matching chips.",
    },
    {
      title: "Play, and rebuy if you need to",
      body: "Play your hands at the table as usual. Busted in a cash game with rebuys on? Rebuy from your balance and get back in.",
      scene: { Component: BuyInCashOutScene, label: "A player buys in for 100 kr, rebuys 50 kr, and cashes out 200 kr in chips, a net of plus 50 kr. The balance goes from 200 to 250 kr." },
    },
    {
      title: "Cash out what's in front of you",
      body: "When you leave, enter the value of the chips you're leaving with. The app works out your net result and puts the money back in your balance.",
    },
    {
      title: "Tournaments: knock players out for bounties",
      body: "In a tournament, everyone also pays into a bounty pool. Knock someone out and record it. Once they or the host confirm, you draw a random bounty from the pool. It's usually about one bounty buy-in, but now and then it's the jackpot.",
      scene: { Component: BountyScene, label: "Anders records that he knocked out Mette. Mette confirms, and Anders opens a mystery bounty worth 75 kr." },
    },
  ],

  winning: {
    summary: "When the game ends you see who won the most and who lost the most that night. Over the season, the group leaderboard shows who's really up.",
    points: [
      "In a tournament, the last player standing takes what's left of the bounty pool.",
      "If the host allows it, the players still in can agree to chop the pot and end early.",
      "Withdraw your balance whenever you like. The house pays it out through the group's payment app.",
    ],
  },

  modes: {
    heading: "Game types",
    items: [
      { icon: "💵", title: "Cash game", body: "Buy in for any amount within the range. Rebuys are optional. Cash out whenever you want." },
      { icon: "🏆", title: "Tournament", body: "A fixed buy-in plus a mystery bounty. Knockouts pay out bounties, and the last one standing takes the rest of the pool." },
    ],
  },

  faq: [
    {
      q: "Is this real money?",
      a: "Yes. It's money between friends, paid in and out through your group's payment app. The house (the group's admins) confirms every top-up and withdrawal.",
    },
    {
      q: "Does the app deal the cards?",
      a: "No. You play with a real deck and real chips. The app only tracks the money.",
    },
    {
      q: "Can I be in more than one group?",
      a: "Yes. Your balance is kept separately for each group, so switch to the right group before you buy in.",
    },
  ],
};
