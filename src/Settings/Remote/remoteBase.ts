import { ICONS, sendLSCGMessage, settingsSave } from "utils";
import { BaseSettingsModel } from "../Models/base";
import { SETTING_FUNC_NAMES, SETTING_FUNC_PREFIX, SETTING_NAME_PREFIX, setSubscreen } from "../setting_definitions";
import { BaseModule } from "base";
import { drawTooltip, GUI } from "../settingUtils";
import { GuiSubscreen, Setting } from "Settings/settingBase";
import { getModule } from "modules";
import { RemoteUIModule } from "Modules/remoteUI";
import { RemoteMainMenu } from "./mainmenu";
import { IPublicSettingsModel, PublicSettingsModel, SettingsModel } from "Settings/Models/settings";
import { CoreModule } from "Modules/core";

export abstract class RemoteGuiSubscreen extends GuiSubscreen {

	readonly Character: OtherCharacter

	constructor(module: BaseModule, C: OtherCharacter) {
		super(module);
		this.Character = C;
	}

    get SubscreenName(): string {
        return SETTING_NAME_PREFIX + this.constructor.name;  
    }

	setSubscreen(screen: RemoteGuiSubscreen): RemoteGuiSubscreen {
		var rootModule = getModule<RemoteUIModule>("RemoteUIModule")
		if (!!rootModule && !!screen)
			rootModule.currentSubscreen = screen;
		return screen;
	}

	get settings(): BaseSettingsModel {
		if (!this.module.settingsStorage) return {} as BaseSettingsModel;
		if (!this.Character?.LSCG || !(<any>this.Character.LSCG)[this.module.settingsStorage]) {
			return {} as BaseSettingsModel; // Somehow a non-mod user made it this far?
		}
		return (<any>this.Character.LSCG)[this.module.settingsStorage];
	}

	settingsSave() {
		if (!this.Character)
			return;
		sendLSCGMessage(<LSCGMessageModel>{
            type: "command",
            reply: false,
            target: this.Character?.MemberNumber!,
            version: LSCG_VERSION,
			settings: this.Character.LSCG,
            command: {
                name: "remote"
            }
        })
	}

	Exit() {
		this.structure.forEach(item => {
			switch (item.type) {
				case "number":
					if (!CommonIsNumeric(ElementValue(item.id))) {
						ElementRemove(item.id);
						break;
					}
				case "text":
					item.setSetting(ElementValue(item.id));
					ElementRemove(item.id);
					break;
			}
		});

		this.settingsSave();
		var rootModule = getModule<RemoteUIModule>("RemoteUIModule")
		if (!!rootModule)
		rootModule.currentSubscreen = new RemoteMainMenu(rootModule, this.Character);
	}
}