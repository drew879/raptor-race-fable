# The string plug-in, as Live saves it

`make_set.py` puts Splice INSTRUMENT on the string tracks without anyone clicking in Live. It can do that because these three files hold what Live itself wrote when the plug-in was put on a track by hand, once, on 2026-11-19.

- `splice-instrument.xml.gz`: the plug-in device, cut out of a saved Live set (the `PluginDevice` element), with its state taken out.
- `labs-strings-short.state` and `labs-strings-long.state`: the plug-in's state with the "Short" and the "Long" preset of the free LABS Strings pack loaded. `make_set.py` puts one of them back into the device as hex.

## What is inside a state

A small wrapper, then plain XML. The XML names the preset (`family="Strings" name="Short"`, and the patch `LABS_Strings_Short_Ensemble`) and lists the plug-in's settings as ids and values. The samples are not in it. They are in `~/Splice/INSTRUMENT/`, where the Splice INSTRUMENT app downloads them.

`splice_state()` in `make_set.py` can change a setting before the state goes into the set. Three lengths in the wrapper have to agree with the XML, and it fixes those. What a calibration export showed about the settings:

- Tightness is `g_general_param_8`. Changing `i_tight` alone does nothing.
- Tightness all the way up moves a short note's peak about 10 thousandths of a second earlier, no more. The note still peaks about 110 after it is played.
- Changing `i_reverb` and `g_general_param_7` made no difference that could be measured.

## To capture another preset

1. In Live, put Splice INSTRUMENT on a MIDI track and open its window.
2. In the plug-in: Your Library, hover the preset, press LOAD.
3. Save the set.
4. Unzip the set (`gunzip -c set.als > set.xml`), find the track's `PluginDevice`, and take the hex inside its `ProcessorState`. Those bytes are the new `.state` file.

The preset has to be downloaded in the Splice INSTRUMENT app first. Only the free LABS packs are used here.
