-- ─────────────────────────────────────────────────────────────────────────────
-- Test game seed: "Pub Quiz Champions"
-- 2 boards · 5 categories each · 5 rows each · Final Jeopardy
-- Board 1: 100–500 pts  |  Board 2 (double): 200–1000 pts
-- All 4 answer modes used · Power-ups on · Buzzed tiles on
--
-- Run once in the Supabase SQL editor while logged in as Goksi0501.
-- Finds the host by email. After running, open jeopardy.gokkehub.com and
-- the game will appear in "My Games".
-- ─────────────────────────────────────────────────────────────────────────────

-- Clean up the duplicate wrong-host_id inserts first:
DELETE FROM jp_games WHERE host_id = 'a96bfdc5-e344-4798-8e1b-8a74b606e95e' AND title = 'Pub Quiz Champions';

INSERT INTO jp_games (id, host_id, title, status, config, collaborators)
VALUES (
  gen_random_uuid(),
  '163343517442113536',
  'Pub Quiz Champions',
  'ready',
  $${
  "teams": { "mode": "solo", "count": 2, "buzzerMode": "anyone" },
  "board2Mode": "custom",
  "powerupCarryover": "persist",

  "buzzer": {
    "noRebuzz":               false,
    "teamLockout":            false,
    "defaultBuzzDisplayMode": "stay",
    "collectionWindowMs":     300
  },

  "powerups": {
    "sniper":       { "enabled": true, "rowRange": [0, 1], "advantageMs": 200 },
    "buffer":       { "enabled": true, "rowRange": [2, 3], "reductionAmount": 100 },
    "secondChance": { "enabled": true, "rowRange": [3, 4] }
  },

  "dangerous": {
    "buzzed": { "enabled": true, "count": 2, "rowRange": [2, 4] }
  },

  "finalJeopardy": {
    "enabled":  true,
    "category": "Around the World",
    "questionBlocks": [
      { "id": "fj-q", "type": "text", "text": "Which tiny sovereign city-state, home to the Pope and covering just 0.44 km², is completely surrounded by the city of Rome?" }
    ],
    "answerBlocks": [
      { "id": "fj-a", "type": "text", "text": "Vatican City" }
    ]
  },

  "boards": [

    {
      "categories":  ["World Geography", "Science & Nature", "Pop Culture", "History", "Food & Drink"],
      "rows":        5,
      "pointValues": [100, 200, 300, 400, 500],
      "tiles": {

        "0-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b1a", "type": "text", "text": "What is the capital city of Australia?" }],
          "answerBlocks":   [{ "id": "b1b", "type": "text", "text": "Canberra" }]
        },
        "0-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "b2a", "type": "text", "text": "Which of these is the largest ocean on Earth?" }],
          "answerBlocks":   [{ "id": "b2b", "type": "text", "text": "The Pacific Ocean" }],
          "answerModeConfig": {
            "options": ["Atlantic Ocean", "Pacific Ocean", "Indian Ocean", "Arctic Ocean"],
            "correctIndex": 1,
            "firstCorrectOnly": false
          }
        },
        "0-2": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b3a", "type": "text", "text": "What is the longest river in the world?" }],
          "answerBlocks":   [{ "id": "b3b", "type": "text", "text": "The Nile (approximately 6,650 km)" }]
        },
        "0-3": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "b4a", "type": "text", "text": "How many countries are member states of the United Nations?" }],
          "answerBlocks":   [{ "id": "b4b", "type": "text", "text": "193 countries" }],
          "answerModeConfig": { "input": "field", "unit": "countries", "correct": 193 }
        },
        "0-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "b5a", "type": "text", "text": "Rank these continents from LARGEST to SMALLEST by total land area." }],
          "answerBlocks":   [{ "id": "b5b", "type": "text", "text": "Asia → Africa → North America → South America → Antarctica → Europe → Australia" }],
          "answerModeConfig": {
            "items":       ["Asia", "Africa", "North America", "South America", "Antarctica", "Europe", "Australia"],
            "scoring":     "partial",
            "topLabel":    "Largest",
            "bottomLabel": "Smallest"
          }
        },

        "1-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b6a", "type": "text", "text": "What is the chemical symbol for gold on the periodic table?" }],
          "answerBlocks":   [{ "id": "b6b", "type": "text", "text": "Au (from the Latin 'Aurum')" }]
        },
        "1-1": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "b7a", "type": "text", "text": "How many bones are in the adult human body?" }],
          "answerBlocks":   [{ "id": "b7b", "type": "text", "text": "206 bones" }],
          "answerModeConfig": { "input": "field", "unit": "bones", "correct": 206 }
        },
        "1-2": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "b8a", "type": "text", "text": "Which organelle is known as the 'powerhouse of the cell'?" }],
          "answerBlocks":   [{ "id": "b8b", "type": "text", "text": "The Mitochondria" }],
          "answerModeConfig": {
            "options": ["Nucleus", "Ribosome", "Mitochondria", "Golgi apparatus"],
            "correctIndex": 2,
            "firstCorrectOnly": false
          }
        },
        "1-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b9a", "type": "text", "text": "What is the most abundant gas in Earth's atmosphere?" }],
          "answerBlocks":   [{ "id": "b9b", "type": "text", "text": "Nitrogen (about 78%)" }]
        },
        "1-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "b10a", "type": "text", "text": "Rank these planets in our solar system from LARGEST to SMALLEST by diameter." }],
          "answerBlocks":   [{ "id": "b10b", "type": "text", "text": "Jupiter → Saturn → Uranus → Neptune → Earth" }],
          "answerModeConfig": {
            "items":       ["Jupiter", "Saturn", "Uranus", "Neptune", "Earth"],
            "scoring":     "partial",
            "topLabel":    "Largest",
            "bottomLabel": "Smallest"
          }
        },

        "2-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b11a", "type": "text", "text": "In which fictional book series does the character Hermione Granger appear?" }],
          "answerBlocks":   [{ "id": "b11b", "type": "text", "text": "Harry Potter" }]
        },
        "2-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "b12a", "type": "text", "text": "Who sang the 2017 global hit 'Shape of You'?" }],
          "answerBlocks":   [{ "id": "b12b", "type": "text", "text": "Ed Sheeran" }],
          "answerModeConfig": {
            "options": ["Justin Bieber", "Ed Sheeran", "Bruno Mars", "The Weeknd"],
            "correctIndex": 1,
            "firstCorrectOnly": false
          }
        },
        "2-2": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b13a", "type": "text", "text": "In which country was the TV series 'Money Heist' (La Casa de Papel) originally produced?" }],
          "answerBlocks":   [{ "id": "b13b", "type": "text", "text": "Spain" }]
        },
        "2-3": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "b14a", "type": "text", "text": "In what year was the original Star Wars film (Episode IV – A New Hope) first released in cinemas?" }],
          "answerBlocks":   [{ "id": "b14b", "type": "text", "text": "1977" }],
          "answerModeConfig": { "input": "field", "unit": "year", "correct": 1977 }
        },
        "2-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "b15a", "type": "text", "text": "Rank these Marvel Cinematic Universe films in ORDER OF THEATRICAL RELEASE, from first to last." }],
          "answerBlocks":   [{ "id": "b15b", "type": "text", "text": "Iron Man (2008) → The Avengers (2012) → Guardians of the Galaxy (2014) → Black Panther (2018) → Avengers: Endgame (2019)" }],
          "answerModeConfig": {
            "items":       ["Iron Man", "The Avengers", "Guardians of the Galaxy", "Black Panther", "Avengers: Endgame"],
            "scoring":     "exact",
            "topLabel":    "Released first",
            "bottomLabel": "Released last"
          }
        },

        "3-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b16a", "type": "text", "text": "In what year did World War II officially end?" }],
          "answerBlocks":   [{ "id": "b16b", "type": "text", "text": "1945" }]
        },
        "3-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "b17a", "type": "text", "text": "Who was the FIRST person to walk on the Moon?" }],
          "answerBlocks":   [{ "id": "b17b", "type": "text", "text": "Neil Armstrong" }],
          "answerModeConfig": {
            "options": ["Buzz Aldrin", "Yuri Gagarin", "Neil Armstrong", "John Glenn"],
            "correctIndex": 2,
            "firstCorrectOnly": false
          }
        },
        "3-2": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "b18a", "type": "text", "text": "In what year did the Berlin Wall fall?" }],
          "answerBlocks":   [{ "id": "b18b", "type": "text", "text": "1989" }],
          "answerModeConfig": { "input": "field", "unit": "year", "correct": 1989 }
        },
        "3-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b19a", "type": "text", "text": "Which of the Seven Wonders of the Ancient World was located on the Greek island of Rhodes?" }],
          "answerBlocks":   [{ "id": "b19b", "type": "text", "text": "The Colossus of Rhodes" }]
        },
        "3-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "b20a", "type": "text", "text": "Rank these inventions from EARLIEST to MOST RECENTLY invented." }],
          "answerBlocks":   [{ "id": "b20b", "type": "text", "text": "Printing Press (1440) → Steam Engine (1769) → Telephone (1876) → Internet (1983) → Smartphone (2007)" }],
          "answerModeConfig": {
            "items":       ["Printing Press", "Steam Engine", "Telephone", "Internet", "Smartphone"],
            "scoring":     "partial",
            "topLabel":    "Earliest invented",
            "bottomLabel": "Most recently invented"
          }
        },

        "4-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b21a", "type": "text", "text": "What fruit is the primary ingredient in guacamole?" }],
          "answerBlocks":   [{ "id": "b21b", "type": "text", "text": "Avocado" }]
        },
        "4-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "b22a", "type": "text", "text": "In which country did sushi originate?" }],
          "answerBlocks":   [{ "id": "b22b", "type": "text", "text": "Japan" }],
          "answerModeConfig": {
            "options": ["China", "South Korea", "Japan", "Thailand"],
            "correctIndex": 2,
            "firstCorrectOnly": false
          }
        },
        "4-2": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "b23a", "type": "text", "text": "Approximately how many calories are in a standard McDonald's Big Mac?" }],
          "answerBlocks":   [{ "id": "b23b", "type": "text", "text": "550 calories" }],
          "answerModeConfig": { "input": "slider", "min": 100, "max": 1000, "unit": "calories", "correct": 550 }
        },
        "4-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "b24a", "type": "text", "text": "What is the pasta shape 'farfalle' also commonly known as in English?" }],
          "answerBlocks":   [{ "id": "b24b", "type": "text", "text": "Bow-tie pasta (also called butterfly pasta)" }]
        },
        "4-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "b25a", "type": "text", "text": "Rank these drinks from LOWEST to HIGHEST alcohol content (ABV)." }],
          "answerBlocks":   [{ "id": "b25b", "type": "text", "text": "Beer (~5%) → Wine (~12%) → Gin (~40%) → Rum (~40–50%) → Everclear (~95%)" }],
          "answerModeConfig": {
            "items":       ["Beer", "Wine", "Gin", "Rum", "Everclear"],
            "scoring":     "partial",
            "topLabel":    "Lowest ABV",
            "bottomLabel": "Highest ABV"
          }
        }

      }
    },

    {
      "categories":  ["Animals", "Music", "Movies & TV", "Sports", "Technology"],
      "rows":        5,
      "pointValues": [200, 400, 600, 800, 1000],
      "tiles": {

        "0-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c1a", "type": "text", "text": "What is the fastest land animal on Earth?" }],
          "answerBlocks":   [{ "id": "c1b", "type": "text", "text": "The Cheetah (up to 120 km/h)" }]
        },
        "0-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "c2a", "type": "text", "text": "How many hearts does an octopus have?" }],
          "answerBlocks":   [{ "id": "c2b", "type": "text", "text": "3 hearts" }],
          "answerModeConfig": {
            "options": ["1", "2", "3", "4"],
            "correctIndex": 2,
            "firstCorrectOnly": false
          }
        },
        "0-2": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c3a", "type": "text", "text": "What is the collective noun for a group of flamingos?" }],
          "answerBlocks":   [{ "id": "c3b", "type": "text", "text": "A flamboyance" }]
        },
        "0-3": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "c4a", "type": "text", "text": "Approximately how many known species of birds exist in the world?" }],
          "answerBlocks":   [{ "id": "c4b", "type": "text", "text": "Approximately 10,000 species" }],
          "answerModeConfig": { "input": "field", "unit": "species", "correct": 10000 }
        },
        "0-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "c5a", "type": "text", "text": "Rank these animals from SHORTEST to LONGEST average lifespan." }],
          "answerBlocks":   [{ "id": "c5b", "type": "text", "text": "Mouse (~2 yrs) → Dog (~13 yrs) → Horse (~25 yrs) → Elephant (~70 yrs) → Greenland Shark (~400 yrs)" }],
          "answerModeConfig": {
            "items":       ["Mouse", "Dog", "Horse", "Elephant", "Greenland Shark"],
            "scoring":     "partial",
            "topLabel":    "Shortest lifespan",
            "bottomLabel": "Longest lifespan"
          }
        },

        "1-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c6a", "type": "text", "text": "Name all four original members of the Swedish pop group ABBA." }],
          "answerBlocks":   [{ "id": "c6b", "type": "text", "text": "Agnetha Fältskog, Björn Ulvaeus, Benny Andersson, Anni-Frid Lyngstad" }]
        },
        "1-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "c7a", "type": "text", "text": "Who has won the most competitive Grammy Awards of all time?" }],
          "answerBlocks":   [{ "id": "c7b", "type": "text", "text": "Beyoncé (32 Grammy wins)" }],
          "answerModeConfig": {
            "options": ["Taylor Swift", "Beyoncé", "Georg Solti", "Michael Jackson"],
            "correctIndex": 1,
            "firstCorrectOnly": false
          }
        },
        "1-2": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "c8a", "type": "text", "text": "In what year did The Beatles officially break up?" }],
          "answerBlocks":   [{ "id": "c8b", "type": "text", "text": "1970" }],
          "answerModeConfig": { "input": "field", "unit": "year", "correct": 1970 }
        },
        "1-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c9a", "type": "text", "text": "Which Norwegian band performed the iconic 1985 hit 'Take On Me'?" }],
          "answerBlocks":   [{ "id": "c9b", "type": "text", "text": "a-ha" }]
        },
        "1-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "c10a", "type": "text", "text": "Rank these music streaming services by number of monthly active users, from MOST to FEWEST." }],
          "answerBlocks":   [{ "id": "c10b", "type": "text", "text": "Spotify → Apple Music → Amazon Music → YouTube Music → Tidal" }],
          "answerModeConfig": {
            "items":       ["Spotify", "Apple Music", "Amazon Music", "YouTube Music", "Tidal"],
            "scoring":     "partial",
            "topLabel":    "Most monthly users",
            "bottomLabel": "Fewest monthly users"
          }
        },

        "2-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c11a", "type": "text", "text": "Who directed the 1994 crime film 'Pulp Fiction'?" }],
          "answerBlocks":   [{ "id": "c11b", "type": "text", "text": "Quentin Tarantino" }]
        },
        "2-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "c12a", "type": "text", "text": "In Disney's 'The Lion King', what is the name of Simba's father?" }],
          "answerBlocks":   [{ "id": "c12b", "type": "text", "text": "Mufasa" }],
          "answerModeConfig": {
            "options": ["Rafiki", "Mufasa", "Scar", "Zazu"],
            "correctIndex": 1,
            "firstCorrectOnly": false
          }
        },
        "2-2": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c13a", "type": "text", "text": "What was the first feature-length animated film ever released by Disney?" }],
          "answerBlocks":   [{ "id": "c13b", "type": "text", "text": "Snow White and the Seven Dwarfs (1937)" }]
        },
        "2-3": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "c14a", "type": "text", "text": "In what year did the first episode of Game of Thrones air on HBO?" }],
          "answerBlocks":   [{ "id": "c14b", "type": "text", "text": "2011" }],
          "answerModeConfig": { "input": "field", "unit": "year", "correct": 2011 }
        },
        "2-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "c15a", "type": "text", "text": "Rank these films from HIGHEST to LOWEST worldwide box office gross of all time." }],
          "answerBlocks":   [{ "id": "c15b", "type": "text", "text": "Avatar ($2.92B) → Avengers: Endgame ($2.80B) → Titanic ($2.26B) → Star Wars: The Force Awakens ($2.07B) → Jurassic World ($1.67B)" }],
          "answerModeConfig": {
            "items":       ["Avatar", "Avengers: Endgame", "Titanic", "Star Wars: The Force Awakens", "Jurassic World"],
            "scoring":     "partial",
            "topLabel":    "Highest box office",
            "bottomLabel": "Lowest box office"
          }
        },

        "3-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c16a", "type": "text", "text": "How many players are on the field per team in a standard game of football (soccer)?" }],
          "answerBlocks":   [{ "id": "c16b", "type": "text", "text": "11 players" }]
        },
        "3-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "c17a", "type": "text", "text": "In which sport would you perform a 'slam dunk'?" }],
          "answerBlocks":   [{ "id": "c17b", "type": "text", "text": "Basketball" }],
          "answerModeConfig": {
            "options": ["Volleyball", "Basketball", "Handball", "Water Polo"],
            "correctIndex": 1,
            "firstCorrectOnly": false
          }
        },
        "3-2": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "c18a", "type": "text", "text": "How many Grand Slam singles titles did Roger Federer win during his career?" }],
          "answerBlocks":   [{ "id": "c18b", "type": "text", "text": "20 Grand Slam titles" }],
          "answerModeConfig": { "input": "field", "unit": "titles", "correct": 20 }
        },
        "3-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c19a", "type": "text", "text": "Which country has won the most FIFA World Cup titles?" }],
          "answerBlocks":   [{ "id": "c19b", "type": "text", "text": "Brazil (5 titles: 1958, 1962, 1970, 1994, 2002)" }]
        },
        "3-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "c20a", "type": "text", "text": "Rank these Formula 1 drivers by number of World Championship titles, from MOST to FEWEST." }],
          "answerBlocks":   [{ "id": "c20b", "type": "text", "text": "Lewis Hamilton (7) = Michael Schumacher (7) → Sebastian Vettel (4) → Fernando Alonso (2) → Jenson Button (1)" }],
          "answerModeConfig": {
            "items":       ["Lewis Hamilton", "Michael Schumacher", "Sebastian Vettel", "Fernando Alonso", "Jenson Button"],
            "scoring":     "partial",
            "topLabel":    "Most championships",
            "bottomLabel": "Fewest championships"
          }
        },

        "4-0": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c21a", "type": "text", "text": "What does the acronym HTTP stand for?" }],
          "answerBlocks":   [{ "id": "c21b", "type": "text", "text": "HyperText Transfer Protocol" }]
        },
        "4-1": {
          "answerMode":     "multipleChoice",
          "questionBlocks": [{ "id": "c22a", "type": "text", "text": "Which operating system holds the largest market share on desktop computers worldwide?" }],
          "answerBlocks":   [{ "id": "c22b", "type": "text", "text": "Windows" }],
          "answerModeConfig": {
            "options": ["macOS", "Linux", "Windows", "Chrome OS"],
            "correctIndex": 2,
            "firstCorrectOnly": false
          }
        },
        "4-2": {
          "answerMode":     "closestNumber",
          "questionBlocks": [{ "id": "c23a", "type": "text", "text": "In what year was the first iPhone released?" }],
          "answerBlocks":   [{ "id": "c23b", "type": "text", "text": "2007" }],
          "answerModeConfig": { "input": "field", "unit": "year", "correct": 2007 }
        },
        "4-3": {
          "answerMode":     "standard",
          "questionBlocks": [{ "id": "c24a", "type": "text", "text": "Who is credited as the creator of the Java programming language?" }],
          "answerBlocks":   [{ "id": "c24b", "type": "text", "text": "James Gosling (at Sun Microsystems, 1995)" }]
        },
        "4-4": {
          "answerMode":     "ranking",
          "questionBlocks": [{ "id": "c25a", "type": "text", "text": "Rank these technology companies by market capitalization, from HIGHEST to LOWEST." }],
          "answerBlocks":   [{ "id": "c25b", "type": "text", "text": "Apple → Microsoft → NVIDIA → Alphabet (Google) → Amazon" }],
          "answerModeConfig": {
            "items":       ["Apple", "Microsoft", "NVIDIA", "Alphabet (Google)", "Amazon"],
            "scoring":     "partial",
            "topLabel":    "Highest market cap",
            "bottomLabel": "Lowest market cap"
          }
        }

      }
    }

  ]
}$$::jsonb,
  '[]'::jsonb
);
