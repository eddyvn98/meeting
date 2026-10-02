"use client";

import { useEffect, useState } from "react";
import {
	DEFAULT_STT_LANG,
	getStoredSttLang,
	getStoredUploadSttLang,
	setStoredSttLang,
	setStoredUploadSttLang,
} from "@/lib/meeting/sttLanguages";
import {
	DEFAULT_TRANSCRIPTION_MODE,
	getStoredTranscriptionMode,
	getStoredUploadTranscriptionMode,
	isMobileDevice,
	setStoredTranscriptionMode,
	setStoredUploadTranscriptionMode,
	type MeetingTranscriptionMode,
} from "@/lib/meeting/stt/transcriptionMode";
import {
	getStoredLiveTranscriptEnabled,
	getStoredLiveTranslationEnabled,
	setStoredLiveTranscriptEnabled,
	setStoredLiveTranslationEnabled,
} from "@/lib/meeting/recorder/liveTranscriptOption";
import { getStoredTranslateLang, setStoredTranslateLang } from "@/lib/meeting/translateLanguages";

/**
 * Recording/upload options shown on Meeting Home. Each scope ("record" or
 * "upload") keeps its own language and model in localStorage, so changing
 * one block never changes the other. The recorder reads the "record" values;
 * uploads pass the "upload" values explicitly.
 *
 * State starts from SSR-safe defaults and loads the stored values in an
 * effect, because reading localStorage during the first render would
 * mismatch the server HTML.
 */
export type MeetingOptionsScope = "record" | "upload";

export function useMeetingOptions(scope: MeetingOptionsScope = "record") {
	const isUpload = scope === "upload";
	const [sttLanguage, setSttLanguage] = useState(DEFAULT_STT_LANG);
	const [transcriptionMode, setTranscriptionMode] = useState<MeetingTranscriptionMode>(DEFAULT_TRANSCRIPTION_MODE);
	const [liveTranscriptEnabled, setLiveTranscriptEnabled] = useState(true);
	const [translationEnabled, setTranslationEnabled] = useState(false);
	const [translateLanguage, setTranslateLanguage] = useState("Vietnamese");
	const [mobileDevice, setMobileDevice] = useState(false);

	useEffect(() => {
		setSttLanguage(isUpload ? getStoredUploadSttLang() : getStoredSttLang());
		setTranscriptionMode(isUpload ? getStoredUploadTranscriptionMode() : getStoredTranscriptionMode());
		setLiveTranscriptEnabled(getStoredLiveTranscriptEnabled());
		setTranslationEnabled(getStoredLiveTranslationEnabled());
		setTranslateLanguage(getStoredTranslateLang());
		setMobileDevice(isMobileDevice());
	}, [isUpload]);

	const changeTranslation = (enabled: boolean) => {
		setTranslationEnabled(enabled);
		setStoredLiveTranslationEnabled(enabled);
		// Translation runs on the live transcript, so it needs the transcript on.
		if (enabled && !liveTranscriptEnabled) changeLiveTranscript(true);
	};

	const changeLiveTranscript = (enabled: boolean) => {
		setLiveTranscriptEnabled(enabled);
		setStoredLiveTranscriptEnabled(enabled);
		if (!enabled && translationEnabled) {
			setTranslationEnabled(false);
			setStoredLiveTranslationEnabled(false);
		}
	};

	return {
		sttLanguage,
		transcriptionMode,
		liveTranscriptEnabled,
		translationEnabled,
		translateLanguage,
		mobileDevice,
		changeLanguage: (code: string) => {
			setSttLanguage(code);
			(isUpload ? setStoredUploadSttLang : setStoredSttLang)(code);
		},
		changeMode: (mode: MeetingTranscriptionMode) => {
			setTranscriptionMode(mode);
			(isUpload ? setStoredUploadTranscriptionMode : setStoredTranscriptionMode)(mode);
		},
		changeLiveTranscript,
		changeTranslation,
		changeTranslateLanguage: (label: string) => {
			setTranslateLanguage(label);
			setStoredTranslateLang(label);
		},
	};
}

export type MeetingOptions = ReturnType<typeof useMeetingOptions>;
