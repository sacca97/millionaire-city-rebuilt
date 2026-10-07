# Complete mission test checklist

Exhaustive row-level tracker for the 318 definitions in `missionDefinitions.xml`: 87 default and 231 `alt_missions`. A mission is not complete from a seeded claim alone. `Trigger` requires a real client action with the mission Up; `Claim/reload` requires the reward and Given state to persist through reload without replay. For blocked external interactions, record the fixture, oracle evidence, and blocker in the Evidence column.

Do not run `tools/apply_optimised_assets.py`. Build test clients only to a separate `/tmp` `--outDir`; do not commit while shared work is uncommitted.

| Set | SKU | Mission | Event | Parameter | Amount / condition | Prerequisite | Base reward | AB group 1 | AB group 2 | Trigger | Claim / reload | Evidence |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|
| default | 1 | Name It | nameCity | — | 1/— | level 1 | coins 20000 | coins;exp 45000;170 | coins 20000 | MATCH | MATCH | `missions-instant-expansion`; post-reload state inspected |
| default | 2 | Pizzalicious | buy | commerce_pizza | 1/— | level 1 | coins 35000 | coins;exp 45000;170 | coins 35000 | TODO | MATCH | `mission-reload` (claim only; trigger pending) |
| default | 3 | Helping Hand | askForHelp | — | 1/— | 17 | coins 35000 | coins;exp 135000;340 | coins 35000 | TODO | TODO |  |
| default | 4 | Size does Matter | buyExpansion | — | 1/— | level 20 | coins 55000 | coins;exp 1905000;1870 | coins 55000 | MATCH | MATCH | `mission-expansion` |
| default | 5 | Instant Build | instantBuild | — | 1/— | level 1 | coins 40000 | coins;exp 45000;170 | coins 40000 | MATCH | MATCH | `mission-expansion` |
| default | 6 | Build I | build | houses_001_002 | 1/— | level 2 | coins 60000 | coins;exp 45000;170 | coins 60000 | MATCH | MATCH | `mission-build` |
| default | 7 | Build II | build | houses_002_001 | 1/— | level 5 | coins 35000 | coins;exp 195000;340 | coins 35000 | TODO | TODO |  |
| default | 8 | Coffeelicious | build | commerce_coffee | 1/— | level 5 | coins 35000 | coins;exp 150000;340 | coins 35000 | TODO | TODO |  |
| default | 9 | Diversify | build | Commerces | 5/— | level 25 | coins 80000 | coins;exp 3810000;2720 | coins 80000 | TODO | TODO |  |
| default | 10 | Green Thumb I | build | Decorations_tree | 2/— | level 1 | coins 35000 | coins;exp 45000;170 | coins 35000 | TODO | TODO |  |
| default | 11 | Fountain Dream | build | decorations_font_02 | 3/— | level 13 | coins 40000 | coins;exp 435000;1190 | coins 40000 | TODO | TODO |  |
| default | 12 | Green Thumb II | build | decorations_font_03 | 1/— | level 24 | coins 40000 | coins;exp 2655000;2550 | coins 40000 | TODO | TODO |  |
| default | 13 | Luxury Houses I | build | houses_002_002 | 1/— | level 6 | coins 40000 | coins;exp 165000;340 | coins 40000 | TODO | TODO |  |
| default | 14 | Luxury Houses II | build | houses_003_002 | 1/— | level 8 | coins 45000 | coins;exp 285000;510 | coins 45000 | TODO | TODO |  |
| default | 15 | Chateau Dream | build | houses_009_001 | 2/— | level 27 | coins 100000 | coins;exp 5040000;3230 | coins 100000 | TODO | TODO |  |
| default | 16 | Skyscraper Dream | build | houses_008_001 | 3/— | level 23 | coins 250000 | coins;exp 2880000;2380 | coins 250000 | TODO | TODO |  |
| default | 17 | World Wonder | build | wonder_statue_of_money | 1/— | level 4 | coins 35000 | coins;exp 210000;340 | coins 35000 | TODO | TODO |  |
| default | 18 | Pizzalicious Clients I | checkInfluence | commerce_pizza | 1/3 | 2 | coins 30000 | coins;exp 45000;170 | coins 30000 | TODO | TODO |  |
| default | 19 | Pizzalicious Clients II | checkInfluence | commerce_pizza | 1/10 | 18 | coins 35000 | coins;exp 60000;170 | coins 35000 | TODO | TODO |  |
| default | 20 | Pizzalicious Clients III | checkInfluence | commerce_pizza | 1/16 | 19 | coins 60000 | coins;exp 105000;170 | decorations_special_04 1 | TODO | MATCH (group 2) | `mission-reward-variant` (group 2) |
| default | 21 | Coffeelicious Clients I | checkInfluence | commerce_coffee | 1/12 | 8 | coins 35000 | coins;exp 150000;340 | coins 35000 | TODO | TODO |  |
| default | 22 | Coffeelicious Clients II | checkInfluence | commerce_coffee | 1/24 | 21 | coins 45000 | coins;exp 165000;340 | coins 45000 | TODO | TODO |  |
| default | 23 | Florist Clients | checkInfluence | commerce_flower_shop | 1/30 | level 7 | coins 50000 | coins;exp 195000;510 | coins 50000 | TODO | TODO |  |
| default | 24 | Night Club Clients | checkInfluence | commerce_night_club | 1/36 | level 20 | coins 60000 | coins;exp 1140000;1870 | coins 60000 | TODO | TODO |  |
| default | 25 | Pimp the House I | bonus | houses_001 | 1/12 | 10 | coins 25000 | coins;exp 45000;170 | coins 25000 | TODO | TODO |  |
| default | 26 | Pimp the House II | bonus | houses_001 | 1/16 | 25 | coins 60000 | coins;exp 75000;170 | coins 60000 | TODO | TODO |  |
| default | 27 | Pimp the House III | bonus | houses_002_001 | 1/30 | 26 | coins 40000 | coins;exp 165000;170 | coins 40000 | TODO | TODO |  |
| default | 28 | Pimp the House IV | bonus | houses_002_001 | 1/60 | 27 | coins 45000 | coins;exp 180000;340 | coins 45000 | TODO | TODO |  |
| default | 29 | Rockstar Villa | bonus | houses_006_001 | 1/90 | level 18 | coins 50000 | coins;exp 1440000;1700 | coins 50000 | TODO | TODO |  |
| default | 30 | Pimp the Chateau | bonus | houses_009_001 | 1/110 | level 28 | coins 150000 | coins;exp 6960000;3400 | decorations_statue_05 1 | TODO | TODO |  |
| default | 31 | Pizzalicious Sale I | collect | commerce_pizza | 1/— | 18 | coins 25000 | coins;exp 60000;170 | coins 25000 | TODO | TODO |  |
| default | 32 | Pizzalicious Sale II | collect | commerce_pizza | 5/— | 31 | commerce_coffee 1 | commerce_coffee 1 | commerce_coffee 1 | TODO | TODO |  |
| default | 33 | Coffeelicious Sale I | collect | commerce_coffee | 10/— | 21 | coins 45000 | coins;exp 165000;340 | coins 45000 | TODO | TODO |  |
| default | 34 | Coffeelicious Sale II | collect | commerce_coffee | 50/— | 33 | coins 55000 | coins;exp 180000;340 | coins 55000 | TODO | TODO |  |
| default | 35 | Show me the Rent I | collect | Houses | 10/— | level 4 | coins 30000 | coins;exp 135000;340 | coins 30000 | MATCH | MATCH | `mission-collect` |
| default | 36 | Show me the Rent II | collect | Houses | 50/— | 35 | coins 35000 | coins;exp 135000;340 | coins 35000 | TODO | TODO |  |
| default | 37 | Show me the Rent III | collect | Houses | 100/— | 36 | coins 40000 | coins;exp 150000;340 | coins 40000 | TODO | TODO |  |
| default | 38 | Show me the Rent IV | collect | Houses | 200/— | 37 | coins 45000 | coins;exp 150000;340 | decorations_tree_12 1 | TODO | TODO |  |
| default | 39 | Visit other Cities | visitCity | — | 1/— | level 2 | coins 35000 | coins;exp 75000;170 | coins 35000 | TODO | TODO |  |
| default | 40 | Help Friends I | upgrade | Houses | 6/— | 39 | houses_002_002 1 | houses_002_002 1 | houses_002_002 1 | TODO | TODO |  |
| default | 41 | Help Friends II | upgrade | Houses | 20/— | 40 | coins 120000 | coins;exp 120000;340 | coins 120000 | TODO | TODO |  |
| default | 42 | Help Friends III | upgrade | Houses | 50/— | 41 | coins 180000 | coins;exp 165000;340 | houses_045_001 1 | TODO | TODO |  |
| default | 43 | Cash is King I | earn | DCCoins | 1/1000000 | level 10 | coins 35000 | coins;exp 375000;1020 | houses_042_001 1 | MATCH | MATCH | `mission-earn` |
| default | 44 | You are a Millionaire I | earn | companyValue | 1/1000000 | level 2 | coins 35000 | coins;exp 60000;170 | coins 35000 | MATCH | MATCH | `mission-earn` |
| default | 45 | You are a Millionaire II | earn | companyValue | 1/5000000 | 44 | coins 55000 | coins;exp 105000;170 | coins 55000 | TODO | TODO |  |
| default | 46 | You are a Millionaire III | earn | companyValue | 1/10000000 | 45 | coins 125000 | coins;exp 120000;340 | decorations_special_51 1 | TODO | TODO |  |
| default | 47 | Show me the Rent V | collect | Houses | 600/— | 38 | decorations_statue_01 1 | decorations_statue_01 1 | decorations_statue_01 1 | TODO | MATCH | `mission-default-item-reward` (claim only; trigger pending) |
| default | 48 | Show me the Rent VI | collect | Houses | 950/— | 47 | coins 100000 | coins;exp 180000;340 | coins 100000 | TODO | TODO |  |
| default | 49 | Help Friends IV | upgrade | Houses | 650/— | 42 | coins 300000 | coins;exp 210000;340 | coins 300000 | TODO | TODO |  |
| default | 50 | Help Friends V | upgrade | Houses | 850/— | 49 | decorations_special_09 1 | decorations_special_09 1 | decorations_special_09 1 | TODO | TODO |  |
| default | 51 | You are a Millionaire IV | earn | companyValue | 1/375000000 | 46 | coins 50000 | coins;exp 195000;340 | coins 50000 | TODO | TODO |  |
| default | 52 | You are a Millionaire V | earn | companyValue | 1/475000000 | 51 | coins 180000 | coins;exp 255000;340 | houses_047_002 1 | TODO | TODO |  |
| default | 53 | Cash is King II | earn | DCCoins | 1/10000000 | 43 | coins 60000 | coins;exp 405000;1020 | coins 60000 | TODO | TODO |  |
| default | 54 | Cash is King III | earn | DCCoins | 1/20000000 | 53 | coins 120000 | coins;exp 540000;1020 | decorations_tree_18 1 | TODO | TODO |  |
| default | 55 | Rock Star Contract | collect | Houses%2 | 200/— | level 12 | coins 90000 | coins;exp 630000;1020 | coins 90000 | TODO | TODO |  |
| default | 56 | The Sheik challenge | beat | — | 1/2 | level 25 | coins 500000 | coins;exp 5340000;2720 | houses_008_005 1 | TODO | TODO |  |
| default | 57 | Show me the Rent VII | collect | Houses | 5000/— | 48 | coins 500000 | coins;exp 195000;510 | coins 500000 | TODO | TODO |  |
| default | 58 | Help Friends VI | upgrade | Houses | 2000/— | 50 | coins 600000 | coins;exp 285000;340 | coins 600000 | TODO | TODO |  |
| default | 59 | You are a Millionaire VI | earn | companyValue | 1/2000000000 | 52 | coins 900000 | coins;exp 225000;340 | coins 900000 | TODO | TODO |  |
| default | 60 | Cash is King IV | earn | DCCoins | 1/300000000 | 54 | coins 900000 | coins;exp 585000;1020 | coins 900000 | TODO | TODO |  |
| default | 61 | Pimp the Colonial | bonus | houses_010_001 | 1/360 | 30 | exp 60000 | coins;exp 7470000;3570 | houses_008_005 1 | TODO | TODO |  |
| default | 62 | Bank Clients | checkInfluence | commerce_bank | 1/529 | level 55 | coins 2000000 | coins;exp 152385000;8840 | houses_044_001 1 | TODO | TODO |  |
| default | 63 | Bowling Clients | checkInfluence | commerce_bowling | 1/243 | level 16 | coins 125000 | coins;exp 660000;1360 | coins 125000 | TODO | TODO |  |
| default | 64 | M-City VIP Club | giveEmail | — | 1/— | level 1 | commerce_vip 1 | commerce_vip 1 | commerce_vip 1 | TODO | TODO |  |
| default | 65 | Business Partners Deal | visitPartner | — | 40/— | level 20 | exp 10000 | coins;exp 1515000;1870 | exp 10000 | TODO | TODO |  |
| default | 66 | Investing | investment | — | 10/— | level 8 | decorations_special_22 1 | coins;exp 495000;510 | houses_042_001 1 | TODO | TODO |  |
| default | 67 | Smart Investing | investmentDone | — | 5/— | level 12 | decorations_tree_18 1 | coins;exp 870000;1020 | houses_011_003 1 | TODO | TODO |  |
| default | 68 | Friendly Visit I | upgrade | houses_005_002 | 70/— | level 8 | coins 30000 | coins;exp 225000;510 | coins 30000 | TODO | TODO |  |
| default | 69 | Friendly Visit II | upgrade | houses_008_001 | 50/— | 68 | coins 40000 | coins;exp 240000;510 | coins 40000 | TODO | TODO |  |
| default | 70 | Friendly Visit IV | upgrade | houses_008_002 | 30/— | 72 | coins 60000 | coins;exp 270000;510 | coins 60000 | TODO | TODO |  |
| default | 71 | Friendly Visit VI | upgrade | houses_008_003 | 20/— | 73 | coins 80000 | coins;exp 315000;1020 | coins 80000 | TODO | TODO |  |
| default | 72 | Friendly Visit III | upgrade | houses_012_001 | 40/— | 69 | coins 50000 | coins;exp 255000;510 | coins 50000 | TODO | TODO |  |
| default | 73 | Friendly Visit V | upgrade | houses_011_001 | 25/— | 70 | coins 70000 | coins;exp 285000;1020 | coins 70000 | TODO | TODO |  |
| default | 74 | Friendly Visit VII | upgrade | houses_013_001 | 10/— | 71 | coins 100000 | coins;exp 330000;1020 | coins 100000 | TODO | TODO |  |
| default | 75 | Pet Shop Clients | checkInfluence | commerce_pet_shop | 1/32 | 23 | coins 50000 | coins;exp 210000;510 | coins 50000 | TODO | TODO |  |
| default | 76 | Jewelry  Clients | checkInfluence | commerce_jewellery_shop | 1/34 | 75 | coins 55000 | coins;exp 225000;510 | coins 55000 | TODO | TODO |  |
| default | 77 | Shared Deal I | collectUpgraded | Houses | 50/— | 39 | coins 180000 | coins;exp 105000;170 | coins 180000 | TODO | TODO |  |
| default | 78 | Shared Deal II | collectUpgraded | Houses | 100/— | 77 | coins 240000 | coins;exp 120000;340 | coins 240000 | TODO | TODO |  |
| default | 79 | Shared Deal III | collectUpgraded | Houses | 200/— | 78 | houses_009_001 1 | houses_009_001 1 | houses_009_001 1 | TODO | TODO |  |
| default | 80 | Shared Deal IV | collectUpgraded | Houses | 400/— | 79 | houses_011_001 1 | houses_011_001 1 | houses_011_001 1 | TODO | TODO |  |
| default | 81 | Shared Deal V | collectUpgraded | Houses | 800/— | 80 | houses_008_003 1 | houses_008_003 1 | houses_008_003 1 | TODO | TODO |  |
| default | 82 | Shared Deal VI | collectUpgraded | Houses | 1600/— | 81 | houses_008_004 1 | houses_008_004 1 | houses_008_004 1 | TODO | TODO |  |
| default | 83 | Shared Deal VII | collectUpgraded | Houses | 3200/— | 82 | houses_013_001 1 | houses_013_001 1 | houses_013_001 1 | TODO | TODO |  |
| default | 84 | Shared Deal VIII | collectUpgraded | Houses | 6400/— | 83 | houses_027_002 1 | houses_027_002 1 | houses_027_002 1 | TODO | TODO |  |
| default | 85 | Shared Deal IX | collectUpgraded | Houses | 7400/— | 84 | houses_033_002 1 | houses_033_002 1 | decorations_tree_18 1 | TODO | TODO |  |
| default | 86 | Shared Deal X | collectUpgraded | Houses | 8500/— | 85 | houses_034_010 1 | houses_034_010 1 | houses_008_005 1 | TODO | TODO |  |
| default | 87 | Transplanting | moveHouse | Decorations_tree | 1/— | level 12 | coins 20000 | coins;exp 495000;1020 | coins 20000 | TODO | TODO |  |
| alt | 89 | Name the company | nameCity | — | 1/— | level 1 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 90 | Buy pizza commerce | buy | commerce_pizza | 1/— | level 1 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 91 | Instant build | instantBuild | — | 1/— | level 1 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 92 | Place 2 Cypress Trees around any Houses | build | decorations_tree_01 | 2/— | level 1 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 93 | Pizza 5 clients | checkInfluence | commerce_pizza | 1/5 | level 1 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 94 | Give email | giveEmail | — | 1/— | level 2 | coins;exp 40000;100 | coins;exp 40000;100 | — | TODO | TODO |  |
| alt | 95 | 5 from Pizza | collect | commerce_pizza | 5/— | level 2 | coins;exp 40000;100 | coins;exp 40000;100 | — | TODO | TODO |  |
| alt | 96 | 1 Bungalow luxury | build | houses_001_002 | 1/— | level 2 | coins;exp 40000;100 | coins;exp 40000;100 | — | TODO | TODO |  |
| alt | 97 | visit a city | visitCity | — | 1/— | level 2 | coins;exp 40000;100 | coins;exp 40000;100 | — | TODO | TODO |  |
| alt | 98 | 1 Million in company value | earn | companyValue | 1/1000000 | level 2 | coins;exp 40000;100 | coins;exp 40000;100 | — | TODO | TODO |  |
| alt | 99 | Bungalow 12% bonus | bonus | houses_001_001 | 1/12 | level 3 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 100 | 1 Wonder | build | wonder_statue_of_money | 1/— | level 3 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 101 | 10 from Houses | collect | Houses | 10/— | level 3 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 102 | 1 Coffe shop | build | commerce_coffee | 1/— | level 4 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 103 | 1 Townhouse Luxury | build | houses_002_002 | 1/— | level 4 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 104 | CollectUpgradedIncomes | collectUpgraded | Houses | 50/— | level 4 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 105 | 10 from Coffee | collect | commerce_coffee | 10/— | level 5 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 106 | Coffee 12 clients | checkInfluence | commerce_coffee | 1/12 | level 5 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 107 | Upgrade Friends Townhouse Luxury: 25  | upgrade | houses_002_002 | 25/— | level 5 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 108 | House Construction: Duplex  | build | houses_003_001 | 1/— | level 6 | coins;exp 110000;200 | coins;exp 110000;200 | — | TODO | TODO |  |
| alt | 109 | Do investments | investment | — | 10/— | level 6 | coins;exp 110000;200 | coins;exp 110000;200 | — | TODO | TODO |  |
| alt | 110 | Time to move | moveHouse | decorations_tree_01 | 1/— | level 6 | coins;exp 110000;200 | coins;exp 110000;200 | — | TODO | TODO |  |
| alt | 111 | Commerce Construction: Sushi Bar  | build | commerce_sushi | 1/— | level 7 | coins;exp 130000;300 | coins;exp 130000;300 | — | TODO | TODO |  |
| alt | 112 | 1 Duplex Luxury | build | houses_003_002 | 1/— | level 7 | coins;exp 130000;300 | coins;exp 130000;300 | — | TODO | TODO |  |
| alt | 113 | 50 from Houses | collect | Houses | 50/— | level 7 | coins;exp 130000;300 | coins;exp 130000;300 | — | TODO | TODO |  |
| alt | 114 | Commerce Construction: Flower Shop  | build | commerce_flower_shop | 1/— | level 8 | coins;exp 150000;300 | coins;exp 150000;300 | — | TODO | TODO |  |
| alt | 115 | Decoration Placement: Windmill  | build | decorations_special_04 | 1/— | level 8 | coins;exp 150000;300 | coins;exp 150000;300 | — | TODO | TODO |  |
| alt | 116 | Upgrade Friends Duplex Luxury: 50  | upgrade | houses_003_002 | 50/— | level 8 | coins;exp 150000;300 | coins;exp 150000;300 | — | TODO | TODO |  |
| alt | 117 | Decoration Placement: 4 Palms  | build | decorations_tree_03 | 4/— | level 9 | coins;exp 170000;300 | coins;exp 170000;300 | — | TODO | TODO |  |
| alt | 118 | Decoration Placement: 2 Agave Plants  | build | decorations_tree_20 | 2/— | level 9 | coins;exp 170000;300 | coins;exp 170000;300 | — | TODO | TODO |  |
| alt | 119 | Duplex Luxury Bonus: 30%  | bonus | houses_003_002 | 1/30 | level 9 | coins;exp 170000;300 | coins;exp 170000;300 | — | TODO | TODO |  |
| alt | 120 | Flower Shop 30 clients | checkInfluence | commerce_flower_shop | 1/30 | level 10 | coins;exp 190000;600 | coins;exp 190000;600 | — | TODO | TODO |  |
| alt | 121 | Decoration Placement: 3 Balloon Boys  | build | decorations_special_01 | 3/— | level 10 | coins;exp 190000;600 | coins;exp 190000;600 | — | TODO | TODO |  |
| alt | 122 | 1 Million in millionaire dollars | earn | DCCoins | 1/1000000 | level 10 | coins;exp 190000;600 | coins;exp 190000;600 | — | TODO | TODO |  |
| alt | 123 | Commerce Collection: 50 Flower Shop  | collect | commerce_flower_shop | 50/— | level 11 | coins;exp 220000;600 | coins;exp 220000;600 | — | TODO | TODO |  |
| alt | 124 | Decoration Placement: Silver Maple  | build | decorations_tree_12 | 1/— | level 11 | coins;exp 220000;600 | coins;exp 220000;600 | — | TODO | TODO |  |
| alt | 125 | Investment successful | investmentDone | — | 5/— | level 11 | coins;exp 220000;600 | coins;exp 220000;600 | — | TODO | TODO |  |
| alt | 126 | 3 Fountains | build | decorations_font_02 | 3/— | level 12 | coins;exp 250000;600 | coins;exp 250000;600 | — | TODO | TODO |  |
| alt | 127 | Decoration Placement: 5 Apple Trees  | build | decorations_tree_06 | 5/— | level 12 | coins;exp 250000;600 | coins;exp 250000;600 | — | TODO | TODO |  |
| alt | 129 | House Construction: Three Story Luxury  | build | houses_004_002 | 1/— | level 13 | coins;exp 290000;700 | coins;exp 290000;700 | — | TODO | TODO |  |
| alt | 130 | Commerce Construction: McDollars  | build | commerce_burger | 1/— | level 13 | coins;exp 290000;700 | coins;exp 290000;700 | — | TODO | TODO |  |
| alt | 131 | Investment Invitations: 20 More  | investment | — | 20/— | level 13 | coins;exp 290000;700 | coins;exp 290000;700 | — | TODO | TODO |  |
| alt | 132 | Friend Visit: 40 | visitPartner | — | 40/— | level 14 | coins;exp 330000;700 | coins;exp 330000;700 | — | TODO | TODO |  |
| alt | 133 | 100 from Houses | collect | Houses | 100/— | level 14 | coins;exp 330000;700 | coins;exp 330000;700 | — | TODO | TODO |  |
| alt | 134 | House Construction: Apartment Block  | build | houses_005_001 | 1/— | level 14 | coins;exp 330000;700 | coins;exp 330000;700 | — | TODO | TODO |  |
| alt | 135 | Decoration Placement: 6 Orange Trees  | build | decorations_tree_04 | 6/— | level 15 | coins;exp 380000;800 | coins;exp 380000;800 | — | TODO | TODO |  |
| alt | 136 | Commerce Construction: Pet Shop  | build | commerce_pet_shop | 1/— | level 15 | coins;exp 380000;800 | coins;exp 380000;800 | — | TODO | TODO |  |
| alt | 137 | 60 upgrades Eco Home | upgrade | houses_012_001 | 60/— | level 15 | coins;exp 380000;800 | coins;exp 380000;800 | — | TODO | TODO |  |
| alt | 139 | 200 from RockStar contract | collect | Houses%2 | 200/— | level 16 | coins;exp 440000;800 | coins;exp 440000;800 | — | TODO | TODO |  |
| alt | 140 | Commerce Collection: 100 Pet Shop  | collect | commerce_pet_shop | 100/— | level 16 | coins;exp 440000;800 | coins;exp 440000;800 | — | TODO | TODO |  |
| alt | 141 | 70 upgrades Apartment Block Luxury | upgrade | houses_005_002 | 70/— | level 17 | coins;exp 500000;900 | coins;exp 500000;900 | — | TODO | TODO |  |
| alt | 142 | Apartment Block Luxury Bonus: 60%  | bonus | houses_005_002 | 1/60 | level 17 | coins;exp 500000;900 | coins;exp 500000;900 | — | TODO | TODO |  |
| alt | 143 | Pet Shop Clients: 50  | checkInfluence | commerce_pet_shop | 1/50 | level 17 | coins;exp 500000;900 | coins;exp 500000;900 | — | TODO | TODO |  |
| alt | 144 | Commerce Construction: Bowling Alley  | build | commerce_bowling | 1/— | level 18 | coins;exp 580000;1000 | coins;exp 580000;1000 | — | TODO | TODO |  |
| alt | 145 | House Construction: House of Harmony  | build | houses_014_002 | 1/— | level 18 | coins;exp 580000;1000 | coins;exp 580000;1000 | — | TODO | TODO |  |
| alt | 146 | Friend Visit: 80 | visitPartner | — | 80/— | level 18 | coins;exp 580000;1000 | coins;exp 580000;1000 | — | TODO | TODO |  |
| alt | 147 | Commerce Construction: Jewelry Shop  | build | commerce_jewellery_shop | 1/— | level 19 | coins;exp 660000;1000 | coins;exp 660000;1000 | — | TODO | TODO |  |
| alt | 148 | World of Wonder: Two More  | build | — | 2/— | level 19 | coins;exp 660000;1000 | coins;exp 660000;1000 | — | TODO | TODO |  |
| alt | 149 | Villa 90% bonus | bonus | houses_006_001 | 1/90 | level 19 | coins;exp 660000;1000 | coins;exp 660000;1000 | — | TODO | TODO |  |
| alt | 150 | Bowling 200 clients | checkInfluence | commerce_bowling | 1/200 | level 20 | coins;exp 760000;1100 | coins;exp 760000;1100 | — | TODO | TODO |  |
| alt | 151 | Own an expansion | buyExpansion | — | 1/— | level 20 | coins;exp 760000;1100 | coins;exp 760000;1100 | — | TODO | TODO |  |
| alt | 152 | 200 from Houses | collect | Houses | 200/— | level 20 | coins;exp 760000;1100 | coins;exp 760000;1100 | — | TODO | TODO |  |
| alt | 153 | House Construction: Loft Block  | build | houses_007_001 | 1/— | level 21 | coins;exp 880000;1200 | coins;exp 880000;1200 | — | TODO | TODO |  |
| alt | 154 | Investment Successes: 10  | investmentDone | — | 10/— | level 21 | coins;exp 880000;1200 | coins;exp 880000;1200 | — | TODO | TODO |  |
| alt | 155 | Commerce Construction: Night Club  | build | commerce_night_club | 1/— | level 21 | coins;exp 880000;1200 | coins;exp 880000;1200 | — | TODO | TODO |  |
| alt | 156 | Jewelry Store Clients: 150  | checkInfluence | commerce_jewellery_shop | 1/150 | level 22 | coins;exp 1010000;1300 | coins;exp 1010000;1300 | — | TODO | TODO |  |
| alt | 157 | Upgrade Friends Loft Block: 100  | upgrade | houses_007_001 | 100/— | level 22 | coins;exp 1010000;1300 | coins;exp 1010000;1300 | — | TODO | TODO |  |
| alt | 158 | Commerce Collection: 150 Bowling Alley  | collect | commerce_bowling | 150/— | level 22 | coins;exp 1010000;1300 | coins;exp 1010000;1300 | — | TODO | TODO |  |
| alt | 159 | House Construction: 2 Villa Luxury  | build | houses_006_002 | 2/— | level 23 | coins;exp 1160000;1400 | coins;exp 1160000;1400 | — | TODO | TODO |  |
| alt | 160 | House Construction: 2 Colonial House  | build | houses_010_001 | 2/— | level 23 | coins;exp 1160000;1400 | coins;exp 1160000;1400 | — | TODO | TODO |  |
| alt | 161 | Decoration Placement: 6 Art Nouveau Lamps  | build | decorations_special_10 | 6/— | level 23 | coins;exp 1160000;1400 | coins;exp 1160000;1400 | — | TODO | TODO |  |
| alt | 162 | Commerce Construction: Mall  | build | commerce_shopping_mall | 1/— | level 24 | coins;exp 1330000;1500 | coins;exp 1330000;1500 | — | TODO | TODO |  |
| alt | 163 | Villa Luxury Bonus: 100%  | bonus | houses_006_002 | 1/100 | level 24 | coins;exp 1330000;1500 | coins;exp 1330000;1500 | — | TODO | TODO |  |
| alt | 164 | House Construction: 2 Parisian Town House  | build | houses_020_002 | 2/— | level 24 | coins;exp 1330000;1500 | coins;exp 1330000;1500 | — | TODO | TODO |  |
| alt | 165 | Decoration Placement: 4 Japanese Trees  | build | decorations_tree_05 | 4/— | level 25 | coins;exp 1530000;1600 | coins;exp 1530000;1600 | — | TODO | TODO |  |
| alt | 166 | Decoration Placement: 5 Bamboos  | build | decorations_tree_14 | 5/— | level 25 | coins;exp 1530000;1600 | coins;exp 1530000;1600 | — | TODO | TODO |  |
| alt | 167 | 1 Big Gardens | build | decorations_font_03 | 1/— | level 25 | coins;exp 1530000;1600 | coins;exp 1530000;1600 | — | TODO | TODO |  |
| alt | 168 | Mall Clients: 250  | checkInfluence | commerce_shopping_mall | 1/250 | level 26 | coins;exp 1760000;1700 | coins;exp 1760000;1700 | — | TODO | TODO |  |
| alt | 169 | Friend Visit: 120 | visitPartner | — | 120/— | level 26 | coins;exp 1760000;1700 | coins;exp 1760000;1700 | — | TODO | TODO |  |
| alt | 170 | Investment Invitations: 30 More  | investment | — | 30/— | level 26 | coins;exp 1760000;1700 | coins;exp 1760000;1700 | — | TODO | TODO |  |
| alt | 171 | Decoration Placement: Statue of David  | build | decorations_statue_05 | 1/— | level 27 | coins;exp 2020000;1900 | coins;exp 2020000;1900 | — | TODO | TODO |  |
| alt | 172 | Decoration Placement: 2 Arch of Success  | build | decorations_statue_03 | 2/— | level 27 | coins;exp 2020000;1900 | coins;exp 2020000;1900 | — | TODO | TODO |  |
| alt | 173 | Upgrade Friends Parisian Town House: 150  | upgrade | houses_020_002 | 150/— | level 27 | coins;exp 2020000;1900 | coins;exp 2020000;1900 | — | TODO | TODO |  |
| alt | 174 | 600 from Houses | collect | Houses | 600/— | level 28 | coins;exp 2320000;2000 | coins;exp 2320000;2000 | — | TODO | TODO |  |
| alt | 175 | Decoration Placement: Triumph Arch  | build | decorations_statue_01 | 1/— | level 28 | coins;exp 2320000;2000 | coins;exp 2320000;2000 | — | TODO | TODO |  |
| alt | 176 | 180 upgrades Skyscraper | upgrade | houses_008_001 | 180/— | level 28 | coins;exp 2320000;2000 | coins;exp 2320000;2000 | — | TODO | TODO |  |
| alt | 177 | Commerce Construction: Bank  | build | commerce_bank | 1/— | level 29 | coins;exp 2670000;2200 | coins;exp 2670000;2200 | — | TODO | TODO |  |
| alt | 178 | Commerce Construction: Hospital  | build | commerce_hospital | 1/— | level 29 | coins;exp 2670000;2200 | coins;exp 2670000;2200 | — | TODO | TODO |  |
| alt | 180 | House Construction: Futuristic City Block  | build | houses_011_001 | 1/— | level 30 | coins;exp 3070000;2300 | coins;exp 3070000;2300 | — | TODO | TODO |  |
| alt | 181 | Investment Successes: 20  | investmentDone | — | 20/— | level 30 | coins;exp 3070000;2300 | coins;exp 3070000;2300 | — | TODO | TODO |  |
| alt | 182 | House Construction: 2 Skyscraper Luxury  | build | houses_008_002 | 2/— | level 30 | coins;exp 3070000;2300 | coins;exp 3070000;2300 | — | TODO | TODO |  |
| alt | 183 | More CV than arab | beat | — | 1/2 | level 31 | coins;exp 3530000;2500 | coins;exp 3530000;2500 | — | TODO | TODO |  |
| alt | 184 | Loft Block Luxury Bonus: 150%  | bonus | houses_007_002 | 1/150 | level 31 | coins;exp 3530000;2500 | coins;exp 3530000;2500 | — | TODO | TODO |  |
| alt | 185 | Commerce Collection: 300 Bank  | collect | commerce_bank | 300/— | level 31 | coins;exp 3530000;2500 | coins;exp 3530000;2500 | — | TODO | TODO |  |
| alt | 186 | Friend Visit: 150 | visitPartner | — | 150/— | level 32 | coins;exp 4060000;2700 | coins;exp 4060000;2700 | — | TODO | TODO |  |
| alt | 187 | House Construction: Chrysler Building  | build | houses_008_005 | 1/— | level 32 | coins;exp 4060000;2700 | coins;exp 4060000;2700 | — | TODO | TODO |  |
| alt | 188 | Expansion II!  | buyExpansion | — | 1/— | level 32 | coins;exp 4060000;2700 | coins;exp 4060000;2700 | — | TODO | TODO |  |
| alt | 189 | Decoration Placement: 20 Gold Maple | build | decorations_tree_11 | 20/— | level 33 | coins;exp 4670000;2900 | coins;exp 4670000;2900 | — | TODO | TODO |  |
| alt | 190 | Hospital Clients: 300 | checkInfluence | commerce_hospital | 1/300 | level 33 | coins;exp 4670000;2900 | coins;exp 4670000;2900 | — | TODO | TODO |  |
| alt | 191 | Decoration Placement: 10 Spruce | build | decorations_tree_15 | 10/— | level 34 | coins;exp 5380000;3100 | coins;exp 5380000;3100 | — | TODO | TODO |  |
| alt | 192 | Investment Invitations: 40 More  | investment | — | 40/— | level 34 | coins;exp 5380000;3100 | coins;exp 5380000;3100 | — | TODO | TODO |  |
| alt | 193 | Decoration Placement: 15 Birch Tree | build | decorations_tree_10 | 15/— | level 35 | coins;exp 6180000;3400 | coins;exp 6180000;3400 | — | TODO | TODO |  |
| alt | 194 | 300 upgrades Loft Block Luxury | upgrade | houses_007_002 | 300/— | level 35 | coins;exp 6180000;3400 | coins;exp 6180000;3400 | — | TODO | TODO |  |
| alt | 195 | House Construction: Designer House | build | houses_018_001 | 1/— | level 36 | coins;exp 7110000;4300 | coins;exp 7110000;4300 | — | TODO | TODO |  |
| alt | 196 | House Construction: Chateau | build | houses_009_001 | 1/— | level 36 | coins;exp 7110000;4300 | coins;exp 7110000;4300 | — | TODO | TODO |  |
| alt | 197 | Designer House Bonus: 200%  | bonus | houses_018_001 | 1/200 | level 37 | coins;exp 8180000;4300 | coins;exp 8180000;4300 | — | TODO | TODO |  |
| alt | 198 | 400 from Football Star contract | collect | Houses%2 | 400/— | level 37 | coins;exp 8180000;4300 | coins;exp 8180000;4300 | — | TODO | TODO |  |
| alt | 199 | Decoration Placement: 5 Chafa | build | decorations_tree_23 | 5/— | level 38 | coins;exp 9410000;4300 | coins;exp 9410000;4300 | — | TODO | TODO |  |
| alt | 200 | Commerce Construction: Opera House | build | commerce_opera | 1/— | level 38 | coins;exp 9410000;4300 | coins;exp 9410000;4300 | — | TODO | TODO |  |
| alt | 201 | Friend Visit: 200 | visitPartner | — | 200/— | level 39 | coins;exp 10820000;4400 | coins;exp 10820000;4400 | — | TODO | TODO |  |
| alt | 202 | 350 upgrades Chateau | upgrade | houses_009_001 | 350/— | level 39 | coins;exp 10820000;4400 | coins;exp 10820000;4400 | — | TODO | TODO |  |
| alt | 203 | Decoration Placement: 3 Fountain II | build | decorations_font_04 | 3/— | level 40 | coins;exp 12440000;4400 | coins;exp 12440000;4400 | — | TODO | TODO |  |
| alt | 204 | 1000 from Houses | collect | Houses | 1000/— | level 40 | coins;exp 12440000;4400 | coins;exp 12440000;4400 | — | TODO | TODO |  |
| alt | 205 | Opera House Clients: 350 | checkInfluence | commerce_opera | 1/350 | level 41 | coins;exp 14310000;4500 | coins;exp 14310000;4500 | — | TODO | TODO |  |
| alt | 206 | Commerce Collection: 600 Opera House  | collect | commerce_opera | 600/— | level 41 | coins;exp 14310000;4500 | coins;exp 14310000;4500 | — | TODO | TODO |  |
| alt | 207 | Decoration Placement: 1 Pond of Wealth | build | decorations_pond_01 | 1/— | level 42 | coins;exp 16460000;4500 | coins;exp 16460000;4500 | — | TODO | TODO |  |
| alt | 208 | World of Wonder: Three More | build | — | 3/— | level 42 | coins;exp 16460000;4500 | coins;exp 16460000;4500 | — | TODO | TODO |  |
| alt | 209 | Commerce Construction: Casino | build | commerce_casino | 1/— | level 43 | coins;exp 18940000;4600 | coins;exp 18940000;4600 | — | TODO | TODO |  |
| alt | 210 | Commerce Construction: Stadium | build | commerce_stadium | 1/— | level 43 | coins;exp 18940000;4600 | coins;exp 18940000;4600 | — | TODO | TODO |  |
| alt | 211 | Casino Clients: 400 | checkInfluence | commerce_casino | 1/400 | level 44 | coins;exp 21780000;4600 | coins;exp 21780000;4600 | — | TODO | TODO |  |
| alt | 212 | House Construction: Futuristic | build | houses_011_001 | 1/— | level 44 | coins;exp 21780000;4600 | coins;exp 21780000;4600 | — | TODO | TODO |  |
| alt | 213 | Expansion III!  | buyExpansion | — | 1/— | level 45 | coins;exp 25060000;4600 | coins;exp 25060000;4600 | — | TODO | TODO |  |
| alt | 214 | 450 upgrades Futuristic | upgrade | houses_011_001 | 450/— | level 45 | coins;exp 25060000;4600 | coins;exp 25060000;4600 | — | TODO | TODO |  |
| alt | 215 | Investment Successes: 30  | investmentDone | — | 30/— | level 46 | coins;exp 28820000;4700 | coins;exp 28820000;4700 | — | TODO | TODO |  |
| alt | 216 | Commerce Construction: Hotel Midas | build | commerce_hotel | 1/— | level 46 | coins;exp 28820000;4700 | coins;exp 28820000;4700 | — | TODO | TODO |  |
| alt | 217 | Stadium Clients: 400 | checkInfluence | commerce_stadium | —/400 | level 47 | coins;exp 33150000;4700 | coins;exp 33150000;4700 | — | TODO | TODO |  |
| alt | 218 | 500 from Hostess contract | collect | Houses%2 | 500/— | level 47 | coins;exp 33150000;4700 | coins;exp 33150000;4700 | — | TODO | TODO |  |
| alt | 219 | Commerce Construction: Midas Mall | build | commerce_luxury_mall | 1/— | level 48 | coins;exp 38130000;4800 | coins;exp 38130000;4800 | — | TODO | TODO |  |
| alt | 220 | Commerce Collection: 800 Casino | collect | commerce_casino | 800/— | level 48 | coins;exp 38130000;4800 | coins;exp 38130000;4800 | — | TODO | TODO |  |
| alt | 221 | Commerce Collection: 1000 Stadium | collect | commerce_stadium | 1000/— | level 49 | coins;exp 43860000;4900 | coins;exp 43860000;4900 | — | TODO | TODO |  |
| alt | 222 | Hotel Midas Clients: 450 | checkInfluence | commerce_hotel | —/450 | level 49 | coins;exp 43860000;4900 | coins;exp 43860000;4900 | — | TODO | TODO |  |
| alt | 223 | Futuristic Bonus: 230%  | bonus | houses_011_001 | 1/230 | level 50 | coins;exp 50450000;4900 | coins;exp 50450000;4900 | — | TODO | TODO |  |
| alt | 224 | Commerce Collection: 1200 Hotel Midas | collect | commerce_hotel | 1200/— | level 50 | coins;exp 50450000;4900 | coins;exp 50450000;4900 | — | TODO | TODO |  |
| alt | 225 | 1250 from Houses | collect | Houses | 1250/— | level 51 | coins;exp 58030000;5000 | coins;exp 58030000;5000 | — | TODO | TODO |  |
| alt | 226 | Friend Visit: 300 | visitPartner | — | 300/— | level 51 | coins;exp 58030000;5000 | coins;exp 58030000;5000 | — | TODO | TODO |  |
| alt | 227 | Midas Mall Clients: 450 | checkInfluence | commerce_luxury_mall | —/450 | level 52 | coins;exp 66750000;5000 | coins;exp 66750000;5000 | — | TODO | TODO |  |
| alt | 228 | Commerce Collection: 1500 Midas Mall | collect | commerce_luxury_mall | 1500/— | level 52 | coins;exp 66750000;5000 | coins;exp 66750000;5000 | — | TODO | TODO |  |
| alt | 229 | House Construction: Luxury Mansion | build | houses_019_001 | 1/— | level 53 | coins;exp 76780000;5100 | coins;exp 76780000;5100 | — | TODO | TODO |  |
| alt | 230 | Investment Invitations: 50 More  | investment | — | 50/— | level 53 | coins;exp 76780000;5100 | coins;exp 76780000;5100 | — | TODO | TODO |  |
| alt | 231 | Expansion IV!  | buyExpansion | — | 1/— | level 54 | coins;exp 88320000;5200 | coins;exp 88320000;5200 | — | TODO | TODO |  |
| alt | 232 | 500 upgrades Luxury Mansion | upgrade | houses_019_001 | 500/— | level 54 | coins;exp 88320000;5200 | coins;exp 88320000;5200 | — | TODO | TODO |  |
| alt | 234 | Luxury Mansion Bonus: 250%  | bonus | houses_019_001 | 1/250 | level 55 | coins;exp 101590000;5200 | coins;exp 101590000;5200 | — | TODO | TODO |  |
| alt | 235 | Commerce Construction: Baseball Stadium | build | commerce_baseball | 1/— | level 55 | coins;exp 101590000;5200 | coins;exp 101590000;5200 | — | TODO | TODO |  |
| alt | 236 | 800 from Artists contract | collect | Houses%2 | 800/— | level 56 | coins;exp 116850000;5300 | coins;exp 116850000;5300 | — | TODO | TODO |  |
| alt | 237 | House Construction: Luxury Mansion II | build | houses_019_002 | 1/— | level 56 | coins;exp 116850000;5300 | coins;exp 116850000;5300 | — | TODO | TODO |  |
| alt | 238 | Baseball Stadium Clients: 500 | checkInfluence | commerce_baseball | —/500 | level 57 | coins;exp 134410000;5400 | coins;exp 134410000;5400 | — | TODO | TODO |  |
| alt | 239 | 600 upgrades Luxury Mansion II | upgrade | houses_019_002 | 600/— | level 57 | coins;exp 134410000;5400 | coins;exp 134410000;5400 | — | TODO | TODO |  |
| alt | 240 | Luxury Mansion II Bonus: 280%  | bonus | houses_019_002 | 1/280 | level 58 | coins;exp 154610000;5500 | coins;exp 154610000;5500 | — | TODO | TODO |  |
| alt | 241 | Commerce Collection: 1750 Baseball Stadium | collect | commerce_baseball | 1750/— | level 58 | coins;exp 154610000;5500 | coins;exp 154610000;5500 | — | TODO | TODO |  |
| alt | 242 | Friend Visit: 400 | visitPartner | — | 400/— | level 59 | coins;exp 177850000;5500 | coins;exp 177850000;5500 | — | TODO | TODO |  |
| alt | 243 | 1500 from Houses | collect | Houses | 1500/— | level 59 | coins;exp 177850000;5500 | coins;exp 177850000;5500 | — | TODO | TODO |  |
| alt | 244 | House Construction: Super Skyscraper | build | houses_008_003 | 1/— | level 60 | coins;exp 204570000;5600 | coins;exp 204570000;5600 | — | TODO | TODO |  |
| alt | 245 | House Construction: Skyscraper Ultimate | build | houses_008_004 | 1/— | level 61 | coins;exp 235310000;5700 | coins;exp 235310000;5700 | — | TODO | TODO |  |
| alt | 246 | 1000 from Friends contract | collect | Houses%2 | 1000/— | level 62 | coins;exp 270670000;5800 | coins;exp 270670000;5800 | — | TODO | TODO |  |
| alt | 247 | Investment Successes: 40  | investmentDone | — | 40/— | level 63 | coins;exp 311350000;5900 | coins;exp 311350000;5900 | — | TODO | TODO |  |
| alt | 248 | 700 upgrades Super Skyscraper | upgrade | houses_008_003 | 700/— | level 64 | coins;exp 358130000;6000 | coins;exp 358130000;6000 | — | TODO | TODO |  |
| alt | 249 | House Construction: Highland Castle | build | houses_013_001 | 1/— | level 65 | coins;exp 411950000;6100 | coins;exp 411950000;6100 | — | TODO | TODO |  |
| alt | 250 | Skyscraper Ultimate Bonus: 290%  | bonus | houses_008_004 | 1/290 | level 66 | coins;exp 473850000;6200 | coins;exp 473850000;6200 | — | TODO | TODO |  |
| alt | 251 | 2000 from Houses | collect | Houses | 2000/— | level 67 | coins;exp 545060000;6300 | coins;exp 545060000;6300 | — | TODO | TODO |  |
| alt | 252 | Expansion V!  | buyExpansion | — | 1/— | level 68 | coins;exp 626970000;6400 | coins;exp 626970000;6400 | — | TODO | TODO |  |
| alt | 253 | World of Wonder: Four More | build | — | 4/— | level 69 | coins;exp 721180000;6500 | coins;exp 721180000;6500 | — | TODO | TODO |  |
| alt | 254 | House Construction: Brazilian Skyscraper | build | houses_027_002 | 1/— | level 70 | coins;exp 829560000;6700 | coins;exp 829560000;6700 | — | TODO | TODO |  |
| alt | 255 | 50 from Coffee | collect | commerce_coffee | 50/— | 105 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 256 | Commerce Collection: 100 Flower Shop  | collect | commerce_flower_shop | 100/— | 123 | coins;exp 240000;600 | coins;exp 240000;600 | — | TODO | TODO |  |
| alt | 257 | Commerce Collection: 200 Pet Shop  | collect | commerce_pet_shop | 200/— | 140 | coins;exp 470000;900 | coins;exp 470000;900 | — | TODO | TODO |  |
| alt | 258 | Commerce Collection: 300 Bowling Alley  | collect | commerce_bowling | 300/— | 158 | coins;exp 1080000;1300 | coins;exp 1080000;1300 | — | TODO | TODO |  |
| alt | 259 | Commerce Collection: 600 Bank  | collect | commerce_bank | 600/— | 185 | coins;exp 3790000;2600 | coins;exp 3790000;2600 | — | TODO | TODO |  |
| alt | 260 | Commerce Collection: 800 Opera House | collect | commerce_opera | 800/— | 206 | coins;exp 15350000;4500 | coins;exp 15350000;4500 | — | TODO | TODO |  |
| alt | 261 | Commerce Collection: 1000 Casino | collect | commerce_casino | 1000/— | 220 | coins;exp 40900000;4800 | coins;exp 40900000;4800 | — | TODO | TODO |  |
| alt | 262 | Commerce Collection: 1200 Stadium | collect | commerce_stadium | 1200/— | 221 | coins;exp 47040000;4900 | coins;exp 47040000;4900 | — | TODO | TODO |  |
| alt | 263 | Commerce Collection: 1500 Hotel Midas | collect | commerce_hotel | 1500/— | 224 | coins;exp 54110000;4900 | coins;exp 54110000;4900 | — | TODO | TODO |  |
| alt | 264 | Commerce Collection: 2000 Midas Mall | collect | commerce_luxury_mall | 2000/— | 228 | coins;exp 71590000;5100 | coins;exp 71590000;5100 | — | TODO | TODO |  |
| alt | 265 | Commerce Collection: 2500 Baseball Stadium | collect | commerce_baseball | 2500/— | 241 | coins;exp 165820000;5500 | coins;exp 165820000;5500 | — | TODO | TODO |  |
| alt | 266 | Pizza 10 clients | checkInfluence | commerce_pizza | 1/10 | 93 | coins;exp 30000;100 | coins;exp 30000;100 | — | TODO | TODO |  |
| alt | 267 | Coffee 24 clients | checkInfluence | commerce_coffee | 1/24 | 106 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 268 | Flower Shop 50 clients | checkInfluence | commerce_flower_shop | 1/50 | 120 | coins;exp 210000;600 | coins;exp 210000;600 | — | TODO | TODO |  |
| alt | 269 | Pet Shop Clients: 80  | checkInfluence | commerce_pet_shop | 1/80 | 143 | coins;exp 540000;900 | coins;exp 540000;900 | — | TODO | TODO |  |
| alt | 270 | Bowling 250 clients | checkInfluence | commerce_bowling | 1/250 | 150 | coins;exp 820000;1200 | coins;exp 820000;1200 | — | TODO | TODO |  |
| alt | 271 | Jewelry Store Clients: 220  | checkInfluence | commerce_jewellery_shop | 1/220 | 156 | coins;exp 1080000;1300 | coins;exp 1080000;1300 | — | TODO | TODO |  |
| alt | 272 | Mall Clients: 300 | checkInfluence | commerce_shopping_mall | 1/300 | 168 | coins;exp 1880000;1800 | coins;exp 1880000;1800 | — | TODO | TODO |  |
| alt | 273 | Hospital Clients: 350 | checkInfluence | commerce_hospital | 1/350 | 190 | coins;exp 5010000;3000 | coins;exp 5010000;3000 | — | TODO | TODO |  |
| alt | 274 | Opera House Clients: 400 | checkInfluence | commerce_opera | 1/400 | 205 | coins;exp 15350000;4500 | coins;exp 15350000;4500 | — | TODO | TODO |  |
| alt | 275 | Casino Clients: 450 | checkInfluence | commerce_casino | 1/450 | 211 | coins;exp 23360000;4600 | coins;exp 23360000;4600 | — | TODO | TODO |  |
| alt | 276 | Stadium Clients: 450 | checkInfluence | commerce_stadium | 1/450 | 217 | coins;exp 35550000;4800 | coins;exp 35550000;4800 | — | TODO | TODO |  |
| alt | 277 | Hotel Midas Clients: 500 | checkInfluence | commerce_hotel | 1/500 | 222 | coins;exp 47040000;4900 | coins;exp 47040000;4900 | — | TODO | TODO |  |
| alt | 278 | Midas Mall Clients: 500 | checkInfluence | commerce_luxury_mall | 1/500 | 227 | coins;exp 71590000;5100 | coins;exp 71590000;5100 | — | TODO | TODO |  |
| alt | 279 | Baseball Stadium Clients: 550 | checkInfluence | commerce_baseball | 1/550 | 238 | coins;exp 144160000;5400 | coins;exp 144160000;5400 | — | TODO | TODO |  |
| alt | 280 | Upgrade Your Friends Buildings: 6 | upgrade | Houses | 6/— | 97 | coins;exp 70000;100 | coins;exp 70000;100 | — | TODO | TODO |  |
| alt | 281 | Upgrade Your Friends Buildings: 20 | upgrade | Houses | 20/— | 280 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 282 | Upgrade Your Friends Buildings: 50 | upgrade | Houses | 50/— | 281 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 283 | Upgrade Your Friends Buildings: 100 | upgrade | Houses | 100/— | 282 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 284 | Upgrade Your Friends Buildings: 200 | upgrade | Houses | 200/— | 283 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 285 | Upgrade Your Friends Buildings: 400 | upgrade | Houses | 400/— | 284 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 286 | Upgrade Your Friends Buildings: 650 | upgrade | Houses | 650/— | 285 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 287 | Upgrade Your Friends Buildings: 850 | upgrade | Houses | 850/— | 286 | coins;exp 110000;200 | coins;exp 110000;200 | — | TODO | TODO |  |
| alt | 288 | Upgrade Your Friends Buildings: 1000 | upgrade | Houses | 1000/— | 287 | coins;exp 120000;200 | coins;exp 120000;200 | — | TODO | TODO |  |
| alt | 289 | Upgrade Your Friends Buildings: 1250 | upgrade | Houses | 1250/— | 288 | coins;exp 130000;300 | coins;exp 130000;300 | — | TODO | TODO |  |
| alt | 290 | Upgrade Your Friends Buildings: 1500 | upgrade | Houses | 1500/— | 289 | coins;exp 140000;300 | coins;exp 140000;300 | — | TODO | TODO |  |
| alt | 291 | Upgrade Your Friends Buildings: 1750 | upgrade | Houses | 1750/— | 290 | coins;exp 150000;300 | coins;exp 150000;300 | — | TODO | TODO |  |
| alt | 292 | Upgrade Your Friends Buildings: 2000 | upgrade | Houses | 2000/— | 291 | coins;exp 160000;300 | coins;exp 160000;300 | — | TODO | TODO |  |
| alt | 293 | Upgraded Income Collection: 100 | collectUpgraded | Houses | 100/— | 104 | coins;exp 170000;300 | coins;exp 170000;300 | — | TODO | TODO |  |
| alt | 294 | Upgraded Income Collection: 200 | collectUpgraded | Houses | 200/— | 293 | coins;exp 180000;300 | coins;exp 180000;300 | — | TODO | TODO |  |
| alt | 295 | Upgraded Income Collection: 400 | collectUpgraded | Houses | 400/— | 294 | coins;exp 190000;600 | coins;exp 190000;600 | — | TODO | TODO |  |
| alt | 296 | Upgraded Income Collection: 800 | collectUpgraded | Houses | 800/— | 295 | coins;exp 210000;600 | coins;exp 210000;600 | — | TODO | TODO |  |
| alt | 297 | Upgraded Income Collection: 1200 | collectUpgraded | Houses | 1200/— | 296 | coins;exp 220000;600 | coins;exp 220000;600 | — | TODO | TODO |  |
| alt | 298 | Upgraded Income Collection: 1600 | collectUpgraded | Houses | 1600/— | 297 | coins;exp 240000;600 | coins;exp 240000;600 | — | TODO | TODO |  |
| alt | 299 | Upgraded Income Collection: 2000 | collectUpgraded | Houses | 2000/— | 298 | coins;exp 250000;600 | coins;exp 250000;600 | — | TODO | TODO |  |
| alt | 300 | Upgraded Income Collection: 2500 | collectUpgraded | Houses | 2500/— | 299 | coins;exp 270000;700 | coins;exp 270000;700 | — | TODO | TODO |  |
| alt | 301 | Upgraded Income Collection: 3000 | collectUpgraded | Houses | 3000/— | 300 | coins;exp 290000;700 | coins;exp 290000;700 | — | TODO | TODO |  |
| alt | 302 | Upgraded Income Collection: 3500 | collectUpgraded | Houses | 3500/— | 301 | coins;exp 310000;700 | coins;exp 310000;700 | — | TODO | TODO |  |
| alt | 303 | Upgraded Income Collection: 4000 | collectUpgraded | Houses | 4000/— | 302 | coins;exp 330000;700 | coins;exp 330000;700 | — | TODO | TODO |  |
| alt | 304 | Upgraded Income Collection: 5000 | collectUpgraded | Houses | 5000/— | 303 | coins;exp 360000;800 | coins;exp 360000;800 | — | TODO | TODO |  |
| alt | 305 | Upgraded Income Collection: 6400 | collectUpgraded | Houses | 6400/— | 304 | coins;exp 380000;800 | coins;exp 380000;800 | — | TODO | TODO |  |
| alt | 306 | Upgraded Income Collection: 7400 | collectUpgraded | Houses | 7400/— | 305 | coins;exp 410000;800 | coins;exp 410000;800 | — | TODO | TODO |  |
| alt | 307 | Upgraded Income Collection: 8500 | collectUpgraded | Houses | 8500/— | 306 | coins;exp 440000;800 | coins;exp 440000;800 | — | TODO | TODO |  |
| alt | 308 | 5 Million in company value | earn | companyValue | 1/5000000 | 98 | coins;exp 70000;100 | coins;exp 70000;100 | — | TODO | TODO |  |
| alt | 309 | 10 Million in company value | earn | companyValue | 1/10000000 | 308 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 310 | 50 Million in company value | earn | companyValue | 1/50000000 | 309 | coins;exp 80000;200 | coins;exp 80000;200 | — | TODO | TODO |  |
| alt | 311 | 120 Million in company value | earn | companyValue | 1/120000000 | 310 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 312 | 240 Million in company value | earn | companyValue | 1/240000000 | 311 | coins;exp 90000;200 | coins;exp 90000;200 | — | TODO | TODO |  |
| alt | 313 | 500 Million in company value | earn | companyValue | 1/500000000 | 312 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 314 | 1000 Million in company value | earn | companyValue | 1/1000000000 | 313 | coins;exp 100000;200 | coins;exp 100000;200 | — | TODO | TODO |  |
| alt | 315 | 2000 Million in company value | earn | companyValue | 1/2000000000 | 314 | coins;exp 110000;200 | coins;exp 110000;200 | — | TODO | TODO |  |
| alt | 316 | 5 Million in millionaire dollars | earn | DCCoins | 1/5000000 | 122 | coins;exp 210000;600 | coins;exp 210000;600 | — | TODO | TODO |  |
| alt | 317 | 10 Million in millionaire dollars | earn | DCCoins | 1/10000000 | 316 | coins;exp 220000;600 | coins;exp 220000;600 | — | TODO | TODO |  |
| alt | 318 | 20 Million in millionaire dollars | earn | DCCoins | 1/20000000 | 317 | coins;exp 240000;600 | coins;exp 240000;600 | — | TODO | TODO |  |
| alt | 319 | 40 Million in millionaire dollars | earn | DCCoins | 1/40000000 | 318 | coins;exp 250000;600 | coins;exp 250000;600 | — | TODO | TODO |  |
| alt | 320 | 80 Million in millionaire dollars | earn | DCCoins | 1/80000000 | 319 | coins;exp 270000;700 | coins;exp 270000;700 | — | TODO | TODO |  |
| alt | 321 | 150 Million in millionaire dollars | earn | DCCoins | 1/150000000 | 320 | coins;exp 290000;700 | coins;exp 290000;700 | — | TODO | TODO |  |
| alt | 322 | 250 Million in millionaire dollars | earn | DCCoins | 1/250000000 | 321 | coins;exp 310000;700 | coins;exp 310000;700 | — | TODO | TODO |  |
| alt | 323 | 400 Million in millionaire dollars | earn | DCCoins | 1/400000000 | 322 | coins;exp 330000;700 | coins;exp 330000;700 | — | TODO | TODO |  |
