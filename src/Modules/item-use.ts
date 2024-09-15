import { BaseModule } from "base";
import { getModule } from "modules";
import { ModuleCategory } from "Settings/setting_definitions";
import { getDominance, GetItemNameAndDescriptionConcat, GetMetadata, getRandomInt, GetTargetCharacter, hookFunction, IsIncapacitated, isPhraseInString, OnAction, OnActivity, removeAllHooksByModule, SendAction, sendLSCGCommand } from "../utils";
import { ActivityBundle, ActivityModule, ActivityTarget } from "./activities";
import { BoopsModule } from "./boops";
import { CollarModule } from "./collar";
import { StateModule } from "./states";
import { InjectorModule } from "./injector";

export const CameraItems: string[] = [
	"Phone1",
	"Phone2",
	"PortalTablet",
	"Camera1",
	"Smartphone"
];

export const MagicWandItems: string[] = [
	"RainbowWand",
	"VibratingWand",
	"SmallVibratingWand",
	"ShockWand",
	"Baguette"
]

export const QuaffableItems: string[] = [
	"PotionBottle"
]

export const PourableItems: string[] = [
	"GlassFilled",
	"Mug"
].concat(QuaffableItems);

export const AdditionalPenetrateItems: string[] = [
	
]

export const EdibleItems: string[] = [
	"Baguette"
]

export const EnhancedItemActivityNames: string[] = [
	"LSCG_Quaff",
	"LSCG_Eat",
	"LSCG_FunnelPour",
	"SipItem",
	"EatItem",
	"ThrowItem"
];

export const TamperProofKeywords = [
	"tamper-proof",
	"tamperproof",
	"tamper proof"
];

export function IsActivityEnhanced(data: ServerChatRoomMessage) {
	let meta = GetMetadata(data);
	let activityName = meta?.ActivityName;
	return meta?.GroupName == "ItemMouth" && EnhancedItemActivityNames.indexOf(activityName ?? "") > -1;
}

export class ActivityRoll {
	constructor(raw: number, mod: number) {
		this.Raw = raw;
		this.Modifier = mod;
	}
	Raw: number = 0;
	Modifier: number = 0;
	get Total(): number { return Math.max(0, this.Raw + this.Modifier); }
	get TotalStr(): string { 
		if (!Player.LSCG?.GlobalModule?.showCheckRolls)
			return "";
		return `[${this.Raw + (this.Modifier < 0 ? "" : "+") + this.Modifier }] `;
	}
}

export interface ActivityCheck {
	AttackerRoll: ActivityRoll;
	DefenderRoll: ActivityRoll;
}

export interface RopeTarget {
	Location: string;
	LocationLabel: string;
	ItemName: string;
	Type?: number;
}

export interface GagTarget {
	MouthItemName: string;
	HandItemName?: string;
	NeckItemName?: string;
	//SourceItemName: string;
	OverrideNeckLocation?: string;
	LeaveHandItem?: boolean;
	CraftedKeys?: string[];
	PreferredTypes?: {Location: string, Type: number}[];
	UsedAssetOverride?: string;
}

// Remote UI Module to handle configuration on other characters
// Can be used to "program" another character's hypnosis, collar, etc.
// Framework inspired from BCX
export class ItemUseModule extends BaseModule {   
	activities: ActivityModule | undefined;
	failedStealTime: number = 0;

	GagTargets: GagTarget[] = [
		{
			MouthItemName: "BallGag",
			HandItemName: "Ballgag",
			NeckItemName: "NecklaceBallGag",
			PreferredTypes: [{Location: "ItemMouth", Type: 2}]
		},{
			MouthItemName: "PantyStuffing",
			HandItemName: "Panties"
		},{
			MouthItemName: "LargeDildo",
			HandItemName: "LargeDildo"
		},{
			MouthItemName: "CaneGag",
			HandItemName: "Cane"
		},{
			MouthItemName: "CropGag",
			HandItemName: "Crop"
		},{
			MouthItemName: "SockStuffing",
			HandItemName: "LongSock"
		},{
			MouthItemName: "ClothStuffing",
			HandItemName: "Towel",
			UsedAssetOverride: "towel"
		},{
			MouthItemName: "RopeBallGag",
			HandItemName: "RopeCoilLong",	
			NeckItemName: "NecklaceRope",
			//LeaveHandItem: true,
			PreferredTypes: [
				{Location: "ItemMouth", Type: 2},
				{Location: "Necklace", Type: 1}
			]
		},{
			MouthItemName: "RopeGag",
			HandItemName: "RopeCoilShort",
			NeckItemName: "NecklaceRope",
			//LeaveHandItem: true
		},{
			MouthItemName: "DuctTape",
			HandItemName: "TapeRoll",
			LeaveHandItem: true,
			PreferredTypes: [
				{Location: "ItemMouth", Type: 1},
				{Location: "ItemMouth2", Type: 3},
				{Location: "ItemMouth3", Type: 4}
			]
		},{
			MouthItemName: "ScarfGag",
			NeckItemName: "Bandana",			
			PreferredTypes: [{Location: "ItemMouth", Type: 1}],
			UsedAssetOverride: "bandana"
		},{
			MouthItemName: "ClothGag",
			NeckItemName: "Scarf",
			OverrideNeckLocation: "ClothAccessory",
			PreferredTypes: [{Location: "ItemMouth", Type: 3}]
		},{
			MouthItemName: "FurScarf",
			NeckItemName: "FurScarf"
		}
	]

    load(): void {
		hookFunction("ActivityGenerateItemActivitiesFromNeed", 1, (args, next) => {
			let allowed = args[0] as ItemActivity[];
			let acting = args[1] as Character;
			let acted = args[2] as Character;
			let needsItem = args[3] as string;
			let activity = args[4] as Activity;
			let ret = false;
			var focusGroup = acted?.FocusGroup?.Name ?? undefined;

			let res;
			if (["GagGiveItem", "GagTakeItem","GagToNecklace", "NecklaceToGag"].indexOf(needsItem) > -1) {
				res = this.ManualGenerateItemActivitiesForNecklaceActivity(allowed, acting, acted, needsItem, activity);
			} else if (needsItem == "FellatioItem") {
				let tmpActivity = Object.assign({}, activity);
				tmpActivity.Reverse = true;
				if (activity.Name == "LSCG_Suck" || activity.Name == "LSCG_Throat")
					needsItem = "PenetrateItem";
				res = next([args[0], args[1], args[2], needsItem, tmpActivity]);
			} else {
				res = next(args);
			}
			return res;
		}, ModuleCategory.ItemUse);

        hookFunction("CharacterItemsForActivity", 1, (args, next) => {
			let C = args[0];
			let itemType = args[1];
			let results = next(args);
			var focusGroup = C?.FocusGroup?.Name ?? undefined;

			let gagTargets = this.GagTargets.filter(t => !!t.MouthItemName).map(t => t.MouthItemName!);
			let neckTargets = this.GagTargets.filter(t => !!t.NeckItemName).map(t => t.NeckItemName!);
			let handTargets = this.GagTargets.filter(t => !!t.HandItemName).map(t => t.HandItemName!);

			if (itemType == "AnyItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item) results.push(item);
			} else if (itemType == "GagTakeItem") {
				let item = InventoryGet(C, focusGroup);	
				if (focusGroup == "ItemNeck") {
					focusGroup = "Necklace";
					item = InventoryGet(C, focusGroup);
					if (!item || neckTargets.indexOf(item?.Asset.Name ?? "") == -1) {
						focusGroup = "ClothAccessory";
						item = InventoryGet(C, focusGroup);
					}
					if (neckTargets.indexOf(item?.Asset.Name ?? "") > -1)
						results.push(item);
				} else {
					if (gagTargets.indexOf(item?.Asset.Name ?? "") > -1)
						results.push(item);
				}
			} else if (itemType == "GagGiveItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (handTargets.indexOf(item?.Asset.Name ?? "") > -1) results.push(item);
			}else if (itemType == "GagToNecklace") {
				let item = InventoryGet(C, focusGroup);
				if (gagTargets.indexOf(item?.Asset.Name ?? "") > -1) results.push(item);
			} else if (itemType == "NecklaceToGag") {
				let item = InventoryGet(C, "Necklace");
				let altItem = InventoryGet(C, "ClothAccessory");
				if (neckTargets.indexOf(item?.Asset.Name ?? "") > -1)
					results.push(item);
				if (neckTargets.indexOf(altItem?.Asset.Name ?? "") > -1)
					results.push(altItem);
			} else if (itemType == "RopeCoil") {
				let item = InventoryGet(C, "ItemHandheld")
				if (!!item && item.Asset.Name.startsWith("RopeCoil"))
					results.push(item)
			} else if (itemType == "PlushItem") {
				let teddy = InventoryGet(C, "ItemMisc");
				let shark = InventoryGet(C, "ItemHandheld");
				if (!!teddy && teddy.Asset.Name == "TeddyBear") 
					results.push(teddy);
				if (!!shark && shark.Asset.Name == "Shark")
					results.push(shark);
			} else if (itemType == "CameraItem") {
				let item = InventoryGet(C, "ItemHandheld");
				let acc = InventoryGet(C, "ClothAccessory");
				if (!!item && CameraItems.indexOf(item.Asset?.Name) > -1) 
					results.push(item);
				else if (!!acc && CameraItems.indexOf(acc.Asset?.Name) > -1) 
					results.push(acc);
			} else if (itemType == "MagicItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item && MagicWandItems.indexOf(item.Asset?.Name) > -1) 
					results.push(item);
			} else if (itemType == "QuaffableItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item && QuaffableItems.indexOf(item.Asset?.Name) > -1) 
					results.push(item);
			} else if (itemType == "PourableItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item && PourableItems.indexOf(item.Asset?.Name) > -1) 
					results.push(item);
			} else if (itemType == "FellatioItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item && (AdditionalPenetrateItems.indexOf(item.Asset?.Name) > -1 || InventoryGetItemProperty(item, "AllowActivity")?.includes("PenetrateItem")))
					results.push(item);
			} else if (itemType == "EdibleItem") {
				let item = InventoryGet(C, "ItemHandheld");
				if (!!item && EdibleItems.indexOf(item.Asset?.Name) > -1) 
					results.push(item);
			}
			return results;
		}, ModuleCategory.ItemUse);

		hookFunction("StruggleMinigameStart", 1, (args, next) => {
			this.Struggling = true;
			next(args);
		})

		hookFunction("StruggleMinigameStop", 1, (args, next) => {
			if (!!StruggleProgressPrevItem && this.Struggling) {
				let itemStr = GetItemNameAndDescriptionConcat(StruggleProgressPrevItem) ?? "";
				if (StruggleProgress < 100 && TamperProofKeywords.some(kw => isPhraseInString(itemStr, kw))) {
					this.PerformTamperProtection("minigame", StruggleProgressPrevItem);
				}
			}
			this.Struggling = false;
			next(args);
		}, ModuleCategory.ItemUse);

		OnActivity(1, ModuleCategory.ItemUse, (data, sender, msg, metadata) => {
			if (sender?.IsPlayer() && msg == "ChatSelf-ItemArms-StruggleArms") {
				this.PerformTamperProtection("activity");
			}
		});

		OnAction(1, ModuleCategory.ItemUse, (data, sender, msg, metadata) => {
			let target = GetTargetCharacter(data);
			if (!sender?.IsPlayer() && target == Player.MemberNumber && msg == "StruggleAssist") {
				this.PerformTamperProtection("assist", undefined, sender);
			}
		});
    }

	Struggling: boolean = false;

	run(): void {
		this.activities = getModule<ActivityModule>("ActivityModule")

		// Put gag on mouth or neck
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "UseGag",
				MaxProgress: 50,
				MaxProgressSelf: 80,
				Prerequisite: ["ZoneAccessible", "ZoneNaked", "UseHands", "Needs-GagGiveItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemMouth",
					TargetLabel: "Gag Mouth",
					TargetAction: "SourceCharacter gags TargetCharacter with PronounPossessive ActivityAsset.",
					TargetSelfAction: "SourceCharacter gags PronounSelf with PronounPossessive own ActivityAsset.",
					SelfAllowed: true
				},<ActivityTarget>{
					Name: "ItemNeck",
					TargetLabel: "Place around Neck",
					TargetAction: "SourceCharacter places PronounPossessive ActivityAsset around TargetCharacter's neck.",
					TargetSelfAction: "SourceCharacter places PronounPossessive ActivityAsset around PronounPossessive own neck.",
					SelfAllowed: true
				}
			],
			CustomPrereqs: [
				{
					Name: "HoldingGag",
					Func: (acting, acted, group) => {
						var location = acted.FocusGroup?.Name ?? group.Name;
						let heldItemName = InventoryGet(acting, "ItemHandheld")?.Asset.Name ?? "";
						let gagTarget = this.GagTargets.find(t => t.HandItemName == heldItemName);
						
						if (!gagTarget)
							return false;

						if (group.Name == "ItemMouth") {
							var existing = InventoryGet(acted, location);
							if (!!existing)
								return false;

							let mouthItemName = gagTarget.MouthItemName ?? "";
							let assetGroup = AssetFemale3DCG.find(a => a.Group == location);
							let allowedAssetNames = assetGroup?.Asset.map(a => (<AssetDefinition>a)?.Name ?? a);
							let targetMouthAssetAllowed = (allowedAssetNames?.indexOf(mouthItemName) ?? -1) > -1;

							var itemAlreadyInMouth = InventoryGet(acted, "ItemMouth")?.Asset.Name == gagTarget.MouthItemName 	||
								InventoryGet(acted, "ItemMouth2")?.Asset.Name == gagTarget.MouthItemName 						||
								InventoryGet(acted, "ItemMouth3")?.Asset.Name == gagTarget.MouthItemName;

							return targetMouthAssetAllowed && !itemAlreadyInMouth;
						} else if (location == "ItemNeck") {
							var existing = InventoryGet(acted, gagTarget.OverrideNeckLocation ?? "Necklace");
							return !existing && !!gagTarget.NeckItemName;
						}
						return false;
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					let ret = next(args);
					var location = target.FocusGroup?.Name  ?? args[1].Dictionary.find((entry: { Tag: string; }) => entry?.Tag == "FocusAssetGroup")?.FocusGroupName;
					let heldItemName = InventoryGet(Player, "ItemHandheld")?.Asset.Name ?? "";
					let gagTarget = this.GagTargets.find(t => t.HandItemName == heldItemName);
					if (!!gagTarget) {
						if (location == "ItemNeck")
							location = gagTarget.OverrideNeckLocation ?? "Necklace";
						this.ApplyGag(target, Player, gagTarget, location);
					}
					return ret;
				}
			},
			CustomImage: "Assets/Female3DCG/ItemHandheld/Preview/Ballgag.png"
		});

		// Take Gag
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "TakeGag",
				MaxProgress: 50,
				MaxProgressSelf: 80,
				Reverse: true,
				Prerequisite: ["Needs-GagTakeItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemMouth",
					TargetLabel: "Take Gag",
					TargetAction: "SourceCharacter removes TargetCharacter's ActivityAsset.",
					TargetSelfAction: "SourceCharacter pulls the ActivityAsset from PronounPossessive mouth.",
					SelfAllowed: true
				}, <ActivityTarget>{
					Name: "ItemNeck",
					TargetLabel: "Take Gag",
					TargetAction: "SourceCharacter takes TargetCharacter's ActivityAsset from around TargetPronounPossessive neck.",
					TargetSelfAction: "SourceCharacter takes PronounPossessive own ActivityAsset from around PronounPossessive neck.",
					SelfAllowed: true
				}
			],
			CustomPrereqs: [
				{
					Name: "TargetIsGagged",
					Func: (acted, acting, group) => {
						let location = acted.FocusGroup?.Name!;
						let item: Item | null;
						let gagTarget: GagTarget | undefined;
						if (location == "ItemNeck") {
							location = "Necklace";
							item = InventoryGet(acted, location);
							gagTarget = this.GagTargets.find(t => !!item && t.NeckItemName == item?.Asset.Name && !!t.HandItemName);
							if (!gagTarget) {
								location = "ClothAccessory";
								item = InventoryGet(acted, location);
								gagTarget = this.GagTargets.find(t => !!item && t.NeckItemName == item?.Asset.Name && !!t.HandItemName);
							}
						} else {
							if (InventoryGroupIsBlocked(acted, location))
								return false;
							item = InventoryGet(acted, location);
							gagTarget = this.GagTargets.find(t => !!item && t.MouthItemName == item?.Asset.Name && !!t.HandItemName);
						}
						
						if (!!item && !!gagTarget) {
							if (!!item.Property && item.Property.Effect && item.Property.Effect.indexOf("Lock") > -1)
								return false;

							var validParams = ValidationCreateDiffParams(acted, acting.MemberNumber!);
							if (!item && !ValidationCanRemoveItem(item!, validParams, false))
								return false;
						}

						return !InventoryGet(acting, "ItemHandheld") && !!gagTarget;
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					let location = target.FocusGroup?.Name ?? args[1].Dictionary.find((entry: { Tag: string; }) => entry?.Tag == "FocusAssetGroup")?.FocusGroupName;
					let itemName: string | undefined;
					let gagTarget: GagTarget | undefined;
					if (location == "ItemNeck") {
						location = "Necklace";
						itemName = InventoryGet(target, location)?.Asset.Name ?? undefined;
						gagTarget = this.GagTargets.find(t => !!itemName && t.NeckItemName == itemName);
						if (!gagTarget) {
							location = "ClothAccessory";
							itemName = InventoryGet(target, location)?.Asset.Name ?? undefined;
							gagTarget = this.GagTargets.find(t => !!itemName && t.NeckItemName == itemName);
						}
					} else {
						itemName = InventoryGet(target, location)?.Asset.Name ?? undefined;
						gagTarget = this.GagTargets.find(t => !!itemName && t.MouthItemName == itemName);
					}

					if (!!gagTarget)
						this.TakeGag(target, Player, gagTarget, location);
					return next(args);
				}
			},
			CustomImage: "Assets/Female3DCG/ItemMouth/Preview/BallGag.png"
		});

		// Gag With Necklace
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "NecklaceToGag",
				MaxProgress: 50,
				MaxProgressSelf: 80,
				Prerequisite: ["UseHands", "Needs-NecklaceToGag"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemMouth",
					TargetLabel: "Move to Mouth",
					TargetAction: "SourceCharacter moves TargetCharacter's ActivityAsset up to TargetPronounPossessive mouth.",
					TargetSelfAction: "SourceCharacter moves PronounPossessive own ActivityAsset up to PronounPossessive mouth.",
					SelfAllowed: true
				},
			],
			CustomPrereqs: [
				{
					Name: "TargetIsWearingGagNecklace",
					Func: (acting, acted, group) => {
						var location = acted.FocusGroup?.Name ?? group.Name;
						var existing = InventoryGet(acted, location);
						if (!!existing)
							return false;
						let gagTarget = this.GagTargets.find(t => t.NeckItemName == (InventoryGet(acted, "Necklace")?.Asset.Name ?? ""));
						if (!gagTarget) gagTarget = this.GagTargets.find(t => t.NeckItemName == (InventoryGet(acted, "ClothAccessory")?.Asset.Name ?? "") && t.OverrideNeckLocation == "ClothAccessory");
						if (!gagTarget)
							return false;
						let mouthItemName = gagTarget.MouthItemName ?? "";
						let assetGroup = AssetFemale3DCG.find(a => a.Group == location);
						let allowedAssetNames = assetGroup?.Asset.map(a => (<AssetDefinition>a)?.Name ?? a);
						let targetMouthAssetAllowed = (allowedAssetNames?.indexOf(mouthItemName) ?? -1) > -1;
						return targetMouthAssetAllowed;
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					var dict = args[1]?.Dictionary;
					if (!target || !dict)
						return;
					var activityAsset = dict.find((x: { Tag: string; }) => x.Tag == "ActivityAsset");
					var location = target.FocusGroup?.Name ?? dict.find((entry: { Tag: string; }) => entry?.Tag == "FocusAssetGroup")?.FocusGroupName;
					let heldItemName = InventoryGet(target, activityAsset.GroupName)?.Asset.Name ?? "";
					let gagTarget = this.GagTargets.find(t => t.NeckItemName == heldItemName);
					//if (!gagTarget) gagTarget = this.GagTargets.find(t => t.NeckItemName == (InventoryGet(target, "ClothAccessory")?.Asset.Name ?? "") && t.OverrideNeckLocation == "ClothAccessory");
					if (!!gagTarget) {
						this.ApplyGag(target, target, gagTarget, location, gagTarget.OverrideNeckLocation ?? "Necklace");
					}
					return next(args);
				}
			},
			CustomImage: "Assets/Female3DCG/Necklace/Preview/NecklaceBallGag.png"
		});

		// Move Gag to Necklace
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "GagToNecklace",
				MaxProgress: 50,
				MaxProgressSelf: 80,
				Prerequisite: ["UseHands", "Needs-GagToNecklace"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemMouth",
					TargetLabel: "Wear around Neck",
					TargetAction: "SourceCharacter removes TargetCharacter's ActivityAsset, letting it hang around their neck.",
					TargetSelfAction: "SourceCharacter removes the ActivityAsset from PronounPossessive mouth and lets it hang around PronounPossessive neck.",
					SelfAllowed: true
				}
			],
			CustomPrereqs: [
				{
					Name: "TargetIsGaggedWithNecklace",
					Func: (acting, acted, group) => {
						var location = acted.FocusGroup?.Name ?? group.Name;
						var item = InventoryGet(acted, location);
						
						if (InventoryGroupIsBlocked(acted, location))
							return false;

						if (!!item) {
							if (!!item.Property && item.Property.Effect && item.Property.Effect.indexOf("Lock") > -1)
								return false;

							var validParams = ValidationCreateDiffParams(acted, acting.MemberNumber!);
							if (!item && !ValidationCanRemoveItem(item!, validParams, false))
								return false;
						}

						var gagTarget = this.GagTargets.find(t => t.MouthItemName == item?.Asset.Name && !!t.NeckItemName);

						return !!gagTarget && 
						!InventoryGet(acted, gagTarget?.OverrideNeckLocation ?? "Necklace") && 
						this.GagTargets.map(t => t.MouthItemName).indexOf(item?.Asset.Name ?? "") > -1;
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					var location = target.FocusGroup?.Name ?? args[1].Dictionary.find((entry: { Tag: string; }) => entry?.Tag == "FocusAssetGroup")?.FocusGroupName;
					let mouthItemName = InventoryGet(target, location)?.Asset.Name ?? "";
					let gagTarget = this.GagTargets.find(t => t.MouthItemName == mouthItemName);
					if (!!gagTarget)
						this.TakeGag(target, target, gagTarget, location, gagTarget?.OverrideNeckLocation ?? "Necklace");
					return next(args);
				}
			},
			CustomImage: "Assets/Female3DCG/ItemMouth/Preview/BallGag.png"
		});

		// Tie Up
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "TieUp",
				MaxProgress: 50,
				MaxProgressSelf: 80,
				Prerequisite: ["UseHands", "ZoneAccessible", "Needs-RopeCoil"]
			},
			Targets: this.GetHempRopeLocations().map(loc => <ActivityTarget>{
						Name: loc.Location,
						TargetLabel: "Tie Up",
						TargetAction: `SourceCharacter swiftly wraps PronounPossessive rope around TargetCharacter's ${loc.LocationLabel}, binding TargetPronounPossessive tightly.`,
						TargetSelfAction: `SourceCharacter wraps PronounPossessive rope around PronounPossessive ${loc.LocationLabel} tightly.`,
						SelfAllowed: true
					}),
			CustomPrereqs: [
				{
					Name: "HasCoiledRope",
					Func: (acting, acted, group) => {
						var location = acted.FocusGroup?.Name ?? group.Name;
						if (!location)
							return false;
						var ropeTarget = this.GetHempRopeLocations().find(t => t.Location == location);
						var validParams = ValidationCreateDiffParams(acted, acting.MemberNumber!);
						var blocked = (location.startsWith("ItemTorso") || location == "ItemPelvis") ? !InventoryDoItemsExposeGroup(acted, "ItemTorso", ["Cloth"]) : false;

						return !blocked && 
							InventoryGet(acting, "ItemHandheld")?.Asset.Name.startsWith("RopeCoil") && 
							!InventoryGet(acted, location);
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					var location = target.FocusGroup?.Name ?? args[1].Dictionary.find((entry: { Tag: string; }) => entry?.Tag == "FocusAssetGroup")?.FocusGroupName ?? "";
					let ropeTarget = this.GetHempRopeLocations().find(loc => loc.Location == location);
					if (!!ropeTarget)
						this.TieUp(target, Player, ropeTarget);
					return next(args);
				}
			},
			CustomImage: "Assets/Female3DCG/ItemArms/Preview/HempRope.png"
		});

		// Steal
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "Steal",
				MaxProgress: 50,
				MaxProgressSelf: 50,
				Prerequisite: ["Needs-AnyItem"],
				Reverse: true // acting and acted are flipped!
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemHands",
					TargetLabel: "Steal",
					TargetAction: "SourceCharacter grabs at TargetCharacters hands, trying to steal TargetPronounPossessive item.",
					SelfAllowed: false
				}
			],
			CustomPrereqs: [
				{
					Name: "CanSteal",
					Func: (acted, acting, group) => { // Clip acting and acted here due to reverse == true
						if (acted.FocusGroup?.Name != "ItemHandheld" || InventoryGet(acted, "ItemHands") != null)
							return false;
						var item = InventoryGet(acted, "ItemHandheld");
						if (!item)
							return false;
						var OnCooldown = this.failedStealTime > 0 && (this.failedStealTime + 60000) > CommonTime(); // 1 minute cooldown on steal attempts.
						var validParams = ValidationCreateDiffParams(acted, acting.MemberNumber!);
						var allowed = ValidationCanRemoveItem(item!, validParams, false);
						return !OnCooldown && allowed && !InventoryGet(acting, "ItemHandheld");
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					this.TrySteal(target, Player, InventoryGet(target, "ItemHandheld")!);
				}
			},
			CustomImage: "Icons/Dress.png"
		});

		// Give
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "Give",
				MaxProgress: 50,
				MaxProgressSelf: 50,
				Prerequisite: ["UseHands", "ZoneAccessible", "TargetZoneAccessible", "Needs-AnyItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemHands",
					TargetLabel: "Give Item",
					TargetAction: "SourceCharacter grabs at TargetCharacters hands, trying to steal TargetPronounPossessive item!",
					SelfAllowed: false
				}
			],
			CustomPrereqs: [
				{
					Name: "CanGive",
					Func: (acting, acted, group) => {
						if (acted.FocusGroup?.Name != "ItemHandheld" || InventoryGet(acted, "ItemHands") != null)
							return false;
						var emptyTargetHands = !InventoryGet(acted, "ItemHandheld");
						var sourceItem = InventoryGet(acting, "ItemHandheld");
						return emptyTargetHands && !!sourceItem;
					}
				}
			],
			CustomAction: {
				Func: (target, args, next) => {
					if (!target)
						return;
					this.GiveItem(target, Player);
				}
			},
			CustomImage: "Icons/Dress.png"
		});

		// Shark Bite
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "SharkBite",
				MaxProgress: 50,
				MaxProgressSelf: 50,
				Prerequisite: ["UseHands", "Needs-AnyItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemArms",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's arm.",
					SelfAllowed: false
				}, <ActivityTarget>{
					Name: "ItemBoots",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's foot.",
					SelfAllowed: false
				}, <ActivityTarget>{
					Name: "ItemBreast",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's breast.",
					SelfAllowed: false
				}, <ActivityTarget>{
					Name: "ItemButt",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's butt.",
					SelfAllowed: false
				}, <ActivityTarget>{
					Name: "ItemEars",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's ear.",
					SelfAllowed: false
				}, <ActivityTarget>{
					Name: "ItemFeet",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's leg.",
					SelfAllowed: false
				},  <ActivityTarget>{
					Name: "ItemHands",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter on the hand.",
					SelfAllowed: false
				},  <ActivityTarget>{
					Name: "ItemLegs",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter in the thigh.",
					SelfAllowed: false
				},  <ActivityTarget>{
					Name: "ItemNeck",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter on the neck.",
					SelfAllowed: false
				},  <ActivityTarget>{
					Name: "ItemNipples",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset bites TargetCharacter's nipple.",
					SelfAllowed: false
				},  <ActivityTarget>{
					Name: "ItemTorso",
					TargetLabel: "Shark Bite",
					TargetAction: "SourceCharacter's ActivityAsset chomps on TargetCharacter.",
					SelfAllowed: false
				}
			],
			CustomPrereqs: [
				{
					Name: "HasShark",
					Func: (acting, acted, group) => {
						var sourceItem = InventoryGet(acting, "ItemHandheld");
						return !!sourceItem && sourceItem.Asset.Name == "Shark";
					}
				}
			],
			CustomImage: "Assets/Female3DCG/ItemHandheld/Preview/Shark.png"
		});

		// Item Boop
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "ItemBoop",
				MaxProgress: 50,
				MaxProgressSelf: 50,
				Prerequisite: ["UseHands", "Needs-AnyItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemNose",
					TargetLabel: "Boop",
					TargetAction: "SourceCharacter boops TargetCharacter's nose with PronounPossessive ActivityAsset.",
					SelfAllowed: false
				}
			],
			CustomImage: "Assets/Female3DCG/Activity/Caress.png"
		});

		// Plush Hug
		this.activities.AddActivity(<ActivityBundle>{
			Activity: <Activity>{
				Name: "PlushHug",
				MaxProgress: 50,
				MaxProgressSelf: 50,
				Prerequisite: ["UseHands", "Needs-PlushItem"]
			},
			Targets: [
				<ActivityTarget>{
					Name: "ItemHands",
					TargetLabel: "Squeeze",
					TargetAction: "SourceCharacter hugs PronounPossessive ActivityAsset tightly.",
					SelfAllowed: true,
					SelfOnly: true
				}
			],
			CustomImage: "Assets/Female3DCG/ItemHandheld/Preview/Shark.png"
		});

		this.activities.AddActivity({
            Activity: <Activity>{
                Name: "TakePhoto",
                MaxProgress: 50,
                MaxProgressSelf: 50,
                Prerequisite: ["UseHands", "Needs-CameraItem"]
            },
            Targets: [
                <ActivityTarget>{
                    Name: "ItemArms",
					TargetLabel: "Take Photo",
                    SelfAllowed: true,
                    TargetAction: "SourceCharacter snaps a photo of TargetCharacter.",
                    TargetSelfAction: "SourceCharacter takes a selfie."
                }
            ],
            CustomAction: {
                Func: (target, args, next) => {
                    this.TakePhoto(target);
                    return next(args);
                }
            },
            CustomImage: "Assets/Female3DCG/ClothAccessory/Preview/Camera1.png"
        });
	}

	TakePhoto(C: Character | null) {
		if (!C) {
			return;
		}
		
		CommonPhotoMode = true;
		let temp = C.FocusGroup;
		C.FocusGroup = null;
		ChatRoomCharacterViewDrawBackground(ChatRoomData?.Background ?? "", 0, 1, 1, false);
		DrawCharacter(C, 0, 0, 1);

		// Capture screen as image URL
		const ImgData = /** @type {HTMLCanvasElement} */ (<any>document?.getElementById("MainCanvas"))?.getContext('2d').getImageData(0, 0, 500, 1000);
		let PhotoCanvas = document.createElement('canvas');
		PhotoCanvas.width = 500;
		PhotoCanvas.height = 1000;
		PhotoCanvas?.getContext('2d')?.putImageData(ImgData, 0, 0);
		const PhotoImg = PhotoCanvas.toDataURL("image/png");

		// Open the image in a new window
		let newWindow = window.open('about:blank', '_blank');
		if (newWindow) {
			newWindow.document.write("<img src='" + PhotoImg + "' alt='from canvas'/>");
			newWindow.document.title = CharacterNickname(C);
			newWindow.document.close();
		} else {
			console.warn("Popups blocked: Cannot open photo in new tab.");
		}

		CommonPhotoMode = false;
		C.FocusGroup = temp;

		sendLSCGCommand(C, "photo");
	}

    unload(): void {
        removeAllHooksByModule(ModuleCategory.ItemUse);
    }

	get d20(): number {
		return getRandomInt(20) + 1;
	}
	
	getRollMod(C: Character, Opponent?: Character, isAggressor: boolean = false): number {
		let buffState = (C as OtherCharacter)?.LSCG?.StateModule?.states?.find(s => s.type == "buffed");

		// Dominant vs Submissive ==> -3 to +3 modifier
		let dominanceMod = Math.floor(getDominance(C) / 33);
		// +5 if we own our opponent
		let ownershipMod = Opponent?.IsOwnedByMemberNumber(C.MemberNumber!) ? 5 : 0 ?? 0;
		// -4 if we're restrained
		let restrainedMod = C.IsRestrained() ? -4 : 0;
		// If edged, -0 to -4 based on arousal
		let edgingMod = C.IsEdged() ? (Math.floor((C.ArousalSettings?.Progress ?? 0) / 25) * -1) : 0;
		// -5 if we're incapacitated, automatic failure if we're also defending
		let incapacitatedMod = IsIncapacitated(C.IsPlayer() ? C as PlayerCharacter : C as OtherCharacter) ? (isAggressor ? 5 : 100) * -1 : 0;
		// -2 for each level of choking
		let breathMod = (C.IsPlayer() ? getModule<CollarModule>("CollarModule").totalChokeLevel : (C as OtherCharacter).LSCG?.CollarModule.chokeLevel ?? 0) * -2;
		// +/- 5 for buff state
		let buffMod = (!buffState || !buffState.active) ? 0 : ((buffState.extensions["negative"] ?? false) ? -5 : 5);

		let finalMod = dominanceMod + ownershipMod + restrainedMod + edgingMod + incapacitatedMod + breathMod + buffMod;
	
		console.debug(`${CharacterNickname(C)} is ${isAggressor ? 'rolling against' : 'defending against'} ${!Opponent ? "nobody" : CharacterNickname(Opponent)} [${finalMod}] --
		dominanceMod: ${dominanceMod}
		ownershipMod: ${ownershipMod}
		restrainedMod: ${restrainedMod}
		edgingMod: ${edgingMod}
		incapacitatedMod: ${incapacitatedMod}
		breathMod: ${breathMod}
		buffMod: ${buffMod}
		`);
	
		return finalMod;
	}

	UnopposedActivityRoll(C: Character) {
		let roll = new ActivityRoll(this.d20, this.getRollMod(C));
		console.debug(`LSCG Roll: ${CharacterNickname(C)} [${roll.Total}]`);
		return roll;
	}

	MakeActivityCheck(attacker: Character, defender: Character): ActivityCheck {
		let attackRoll = new ActivityRoll(this.d20, this.getRollMod(attacker, defender, true));
		let defendRoll = new ActivityRoll(this.d20, this.getRollMod(defender, attacker, false));
		console.debug(`LSCG Roll: ${CharacterNickname(attacker)} [${attackRoll.Total}] -- ${CharacterNickname(defender)} [${defendRoll.Total}]`);
		return <ActivityCheck>{
			AttackerRoll: attackRoll,
			DefenderRoll: defendRoll
		};
	}

	GetHempRopeLocations(): RopeTarget[] {
		return AssetFemale3DCG.filter(g => g.Asset.some(a => (a as AssetDefinition)?.Name == "HempRope")).map(g => <RopeTarget>{
			Location: g.Group,
			LocationLabel: g.Group.substring(4).toLocaleLowerCase(),
			ItemName: "HempRope"
		}).concat([
			{
				Location: "ItemHead",
				LocationLabel: "eyes",
				ItemName: "RopeBlindfold"
			},{
				Location: "ItemNeck",
				LocationLabel: "neck",
				ItemName: "NeckRope"
			},{
				Location: "ItemTorso",
				LocationLabel: "breasts",
				ItemName: "HempRopeHarness",
				Type: 3
			},{
				Location: "ItemTorso2",
				LocationLabel: "waist",
				ItemName: "HempRopeHarness",
				Type: 1
			},{
				Location: "ItemBoots",
				LocationLabel: "toes",
				ItemName: "ToeTie"
			}
		]);
	}

	_handleWeirdColorStuff(itemToMove: Item, gagTarget: GagTarget, sourceLocation: string, targetLocation: string): ItemColor | undefined {
		var color = itemToMove?.Color;
		// BallGag necklace + mouth gag alternate order...
		if (!!color && gagTarget.MouthItemName == "BallGag") {
			if ((sourceLocation?.startsWith("ItemMouth") && targetLocation == "Necklace") ||
				(sourceLocation == "Necklace" && targetLocation?.startsWith("ItemMouth")))
				color = (<string[]>(<ItemColor>color)).reverse();
			else if (sourceLocation == "Necklace" && targetLocation == "ItemHandheld")
				color = [color[1]];
			else if (sourceLocation == "ItemHandheld") {
				color = [color[0], color[0]];
			}
		}
		return color;
	}

	ApplyGag(target: Character, source: Character, gagTarget: GagTarget, targetLocation: string, sourceLocation: string = "ItemHandheld") {
		var gagItem = InventoryGet(source, sourceLocation);
		let sourceItemName = (sourceLocation == "ItemHandheld" ? gagTarget.HandItemName : gagTarget.NeckItemName) ?? "";
		let targetItemName = (targetLocation?.startsWith("ItemMouth") ? gagTarget.MouthItemName : gagTarget.NeckItemName) ?? "";
		if (!!gagItem && gagItem.Asset.Name == sourceItemName) {
			if (!(gagTarget.LeaveHandItem && sourceLocation == "ItemHandheld")) InventoryRemove(source, sourceLocation, source.MemberNumber != target.MemberNumber);
			var color = this._handleWeirdColorStuff(gagItem, gagTarget, sourceLocation, targetLocation);
			InventoryWear(target, targetItemName, targetLocation, color, undefined, source.MemberNumber, gagItem?.Craft, false);
			let gag = InventoryGet(target, targetLocation);
			if (!!gagTarget.PreferredTypes && gagTarget.PreferredTypes.length > 0) {
				var prefType = gagTarget.PreferredTypes.find(tgt => tgt.Location == targetLocation) ?? gagTarget.PreferredTypes.find(tgt => targetLocation.startsWith(tgt.Location));
				if (!!gag && !!prefType) {
					if (!gag.Property) gag.Property = {};
					if (!gag.Property.TypeRecord)
						gag.Property.TypeRecord = {"typed": prefType.Type};
					else
						gag!.Property!.TypeRecord["typed"] = prefType.Type;
				}
			}
			ChatRoomCharacterUpdate(target);
		}
    }

	TakeGag(target: Character, source: Character, gagTarget: GagTarget, sourceLocation: string, targetLocation: string = "ItemHandheld") {
		var gag = InventoryGet(target, sourceLocation);
		var existing = InventoryGet(source, targetLocation);
		let sourceItemName = (sourceLocation.startsWith("ItemMouth") ? gagTarget.MouthItemName : gagTarget.NeckItemName) ?? "";
		let targetItemName = (targetLocation == "ItemHandheld" ? gagTarget.HandItemName : gagTarget.NeckItemName) ?? "";
		if (!gag || !!existing || gag.Asset.Name != sourceItemName)
			return;
		var validParams = ValidationCreateDiffParams(target, source.MemberNumber!);
		if (ValidationCanRemoveItem(gag!, validParams, false)) {
			InventoryRemove(target, sourceLocation, true);
			var craft = gag.Craft;
			if (!!craft) {
				craft.Lock = "";
				if (craft.Property == "Large" || craft.Property == "Small") {
					craft.Property = "Normal";
				}
			}
			var color = this._handleWeirdColorStuff(gag, gagTarget, sourceLocation, targetLocation);
			let item = InventoryWear(source, targetItemName, targetLocation, color, undefined, source.MemberNumber, craft, false);			
			if (!!gagTarget.PreferredTypes && gagTarget.PreferredTypes.length > 0) {
				var prefType = gagTarget.PreferredTypes.find(tgt => tgt.Location == targetLocation) ?? gagTarget.PreferredTypes.find(tgt => targetLocation.startsWith(tgt.Location));
				if (!!item && !!prefType) {
					if (!item.Property) item.Property = {};
					if (!item.Property.TypeRecord)
						item.Property.TypeRecord = {"typed": prefType.Type};
					else
						item!.Property!.TypeRecord["typed"] = prefType.Type;
				}
			}
			ChatRoomCharacterUpdate(target);
			ChatRoomCharacterUpdate(source);
		}
	}

	TieUp(target: Character, source: Character, rope: RopeTarget) {
		var handRope = InventoryGet(source, "ItemHandheld");
		if (handRope?.Asset.Name.startsWith("RopeCoil")) {
			var ropeTie = InventoryWear(target, rope.ItemName, rope.Location, handRope?.Color, undefined, source.MemberNumber, handRope?.Craft);
			if (!!rope.Type && !!ropeTie)
				(<any>ropeTie!.Property!.TypeRecord) = {"typed": rope.Type};
			ChatRoomCharacterUpdate(target);
		}
	}

	getItemName(item: Item) {
		return item.Craft?.Name ?? item.Asset.Description.toLocaleLowerCase();
	}

	GiveItem(target: Character, source: Character) {
		var item = InventoryGet(source, "ItemHandheld");
		if (!item)
			return;
			SendAction(`${CharacterNickname(source)} gives %POSSESSIVE% ${this.getItemName(item)} to ${CharacterNickname(target)}.`);
		InventoryRemove(source, "ItemHandheld", false);
		let newItem = InventoryWear(target, item?.Asset.Name!, "ItemHandheld", item?.Color, item?.Difficulty, source.MemberNumber, item?.Craft, false);
		if (!!newItem) newItem.Property = item.Property;
		setTimeout(() => ChatRoomCharacterUpdate(source));
		setTimeout(() => ChatRoomCharacterUpdate(target));
	}

	TrySteal(target: Character, source: Character, item: Item) {
		SendAction(`${CharacterNickname(Player)} grabs at ${CharacterNickname(target)}'s ${this.getItemName(item)}, trying to steal it!`);
		setTimeout(() => this.Steal_Roll(target, source, item), 5000);
	}

	Steal_Roll(target: Character, source: Character, item: Item) {
		let check = this.MakeActivityCheck(Player, target);

		if (check.AttackerRoll.Total >= check.DefenderRoll.Total) {
			SendAction(`%NAME% ${check.AttackerRoll.TotalStr}manages to wrest %OPP_NAME%'s ${check.DefenderRoll.TotalStr}${this.getItemName(item)} out of %OPP_POSSESSIVE% grasp!`, target);
			InventoryRemove(target, "ItemHandheld", false);
			let newItem = InventoryWear(Player, item.Asset.Name, "ItemHandheld", item.Color, item.Difficulty, Player.MemberNumber, item.Craft, false);
			if (!!newItem) newItem.Property = item.Property;
			setTimeout(() => ChatRoomCharacterUpdate(Player));
			setTimeout(() => ChatRoomCharacterUpdate(target));
		}
		else {
			SendAction(`%NAME% ${check.AttackerRoll.TotalStr}fails to steal %OPP_NAME%'s ${check.DefenderRoll.TotalStr}${this.getItemName(item)} and is dazed from the attempt!`, target);
			this.failedStealTime = CommonTime();
		}
	}

	ManualGenerateItemActivitiesForNecklaceActivity(allowed: ItemActivity[], acting: Character, acted: Character, needsItem: string, activity: Activity) {
		const itemOwner = needsItem == "GagGiveItem" ? acting : acted;
		const items = CharacterItemsForActivity(itemOwner, needsItem);
		if (items.length === 0) return true;
	
		let handled = false;
		for (const item of items) {
			const types = (!!item.Property && CommonIsObject(item.Property?.TypeRecord)) ? PropertyTypeRecordToStrings(item.Property?.TypeRecord ?? <TypeRecord>{}) : [null];
	
			let blocked: ItemActivityRestriction | null = null;
			let focusGroup = acted.FocusGroup?.Name;
			let itemName = item.Asset.Name;
			let gagTarget = this.GagTargets.find(t => [t.MouthItemName, t.HandItemName, t.NeckItemName].indexOf(itemName) > -1);
			
			let targetItemName = gagTarget?.MouthItemName;
			if (focusGroup == "ItemNeck" || needsItem == "GagToNecklace") targetItemName = gagTarget?.NeckItemName;
			else if (needsItem == "GagTakeItem") targetItemName = gagTarget?.HandItemName;
			
			let targetAssetGroup = "ItemMouth";
			if (focusGroup == "ItemNeck" || needsItem == "GagToNecklace") targetAssetGroup = gagTarget?.OverrideNeckLocation ?? "Necklace";
			else if (needsItem == "GagTakeItem") targetAssetGroup = "ItemHandheld";
			
			let targetItem = <Item>{Asset: AssetGet("Female3DCG", targetAssetGroup, targetItemName ?? "")};
			let targetOwner = needsItem == "GagTakeItem" ? acting : acted;
			if (targetItem.Asset != null) {
				if (types.some((type) => InventoryIsAllowedLimited(targetOwner, targetItem, type ?? ""))) {
					blocked = "limited";
				} else if (types.some((type) => InventoryBlockedOrLimited(targetOwner, targetItem, type))) {
					blocked = "blocked";
				} else if (InventoryGroupIsBlocked(targetOwner, /** @type {AssetGroupItemName} */(targetItem.Asset.Group.Name))) {
					blocked = "unavail";
				}
			} else {
				blocked = "unavail";
			}
	
			if (!!blocked) {
				allowed.push({ Activity: activity, Item: item, Blocked: blocked });
			} else
				allowed.push({ Activity: activity, Item: item });
			handled = true;
		}
		return handled;
	}

	electricKeywords: string[] = [
		"electric",
		"electrified",
		"shocking"
	];

	selfTighteningKeywords: string[] = [
		"self-tightening",
		"selftightening",
		"self tightening",
		"auto-tightening",
		"auto tightening"
	];

	subduingKeywords: string[] = [
		"sedating",
		"numbing",
		"subduing"
	];

	PerformTamperProtection(source: "minigame" | "activity" | "assist", item: Item | undefined = undefined, sender: Character | null = null) {
		if (!Player.LSCG.GlobalModule.tamperproofEnabled)
			return;

		if (!item) {
			let tamperProofItems = Player.Appearance.filter(a => {
				let itemStr = GetItemNameAndDescriptionConcat(a) ?? "";
				return a.Asset.Group.Name != "ItemHandheld" && TamperProofKeywords.some(k => isPhraseInString(itemStr, k));
			});
			if (tamperProofItems.length > 0)
				item = tamperProofItems[getRandomInt(tamperProofItems.length)];
		}
		if (!item)
			return;

		let itemStr = GetItemNameAndDescriptionConcat(item) ?? "";
		let itemName = item.Craft?.Name ?? item.Asset.Name;
		let itemTypes: string[] = [];
		
		if (this.electricKeywords.some(k => isPhraseInString(itemStr, k)) && (Player.LSCG.GlobalModule.tamperproofElectricityEnabled ?? true))
			itemTypes.push("electric");
		if (this.selfTighteningKeywords.some(k => isPhraseInString(itemStr, k)))
			itemTypes.push("tightening");
		if (this.subduingKeywords.some(k => isPhraseInString(itemStr, k)))
			itemTypes.push("subduing");
		if (itemTypes.length <= 0)
			itemTypes = ["generic"];

		let selectedType = itemTypes[getRandomInt(itemTypes.length)];
		switch (selectedType) {
			case "electric":
				let shockLevel = (getRandomInt(50)/50)+0.5;
				SendAction(`%NAME%'s ${itemName} punishes ${!sender ? "%POSSESSIVE%" : CharacterNickname(sender) + "'s"} meddling with a sharp jolt.`);
				AudioPlaySoundEffect("Shocks", 3 + (3 * shockLevel));
				const duration = (Math.random() + shockLevel * 1.5) * 500;
				DrawFlashScreen("#FFFFFF", duration, 500);
				break;
			case "tightening":
				SendAction(`%NAME%'s ${itemName} tightens around %INTENSIVE%, countering ${!sender ? "%POSSESSIVE%" : CharacterNickname(sender) + "'s"} tampering.`);
				item.Difficulty = (item.Difficulty ?? 0) + 5;
				if (item.Asset.Group.Name == "ItemNeck" && getModule<CollarModule>("CollarModule").WearingCorrectCollar(Player)) {
					getModule<CollarModule>("CollarModule").IncreaseCollarChoke();
				} else {
					AudioPlaySoundEffect("ZipTie", 1);
				}
				ChatRoomCharacterUpdate(Player);
				break;
			case "subduing":
				SendAction(`%NAME%'s ${itemName} releases a sedating spray, resisting ${!sender ? "%POSSESSIVE%" : CharacterNickname(sender) + "'s"} meddling, and weakening %POSSESSIVE% muscles.`);
				AudioPlaySoundEffect("Deflation", 1);
				let injectModule = getModule<InjectorModule>("InjectorModule");
				if (injectModule.Enabled && injectModule.settings.enableSedative)
					getModule<InjectorModule>("InjectorModule").AddSedative(1, getRandomInt(3) != 0);
				break;
			case "generic":
			default:
				SendAction(`%NAME%'s ${itemName} clicks menacingly as it resists ${!sender ? "%POSSESSIVE%" : CharacterNickname(sender) + "'s"} tampering.`);
				AudioPlaySoundEffect("LockLarge");
				break;
		}
	}
}
