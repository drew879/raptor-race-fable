#!/usr/bin/env python3
"""Write "Chase Strings" as an Ableton Live 12 set: every part of the chase music as MIDI on its
own named track, at 120 beats a minute, with a sound on every track, so it can be played, changed
and mixed in Live, and exported for the game.

    python3 music/ableton/make_set.py

A Live set (.als) is gzipped XML. This does not write that XML from nothing: it starts from one
of Live's own clip files (a whole one-track set, saved by Live 12.3), copies its MIDI track once
for each part, and puts the notes in. The notes are the same ones the game plays
(src/audio/sound.ts); if the music changes there, change it here too.

The sounds:
  strings  Splice INSTRUMENT (the free plug-in LABS moved into), playing "Short" and "Long" from
           the free LABS Strings pack. The plug-in as Live saves it is in devices/, with what it
           was set to for each of the two (see devices/README.md for how they were captured).
  drums    single hits from the Tamuz Kit in Live's Core Library, through one of Live's halls
  bells    the Celeste from the Core Library (the game plays its own bell for each piece of amber;
           this track is here to hear the line against the rest)

What is laid out, in Live's Arrangement:
  bars 1-24   the loop, three times over, every part. The game's layers are cut from the middle
              time through (bars 9-16), which has the first one's echoes still ringing under it.
  bar 24      is also the bar of the egg's dash: the loop's last bar, with the build over it
  bars 25-27  the landing, ringing out
  bars 33-36  the build again, eight seconds long, for the game to cut from (a dash can last
              longer than its bar when the runner is slow to it)
"""
import copy
import gzip
import os
import re
import struct
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
CORE = '/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library'
TEMPLATE = f'{CORE}/MIDI Clips/Tonal/Chord Progression/Dramatic Strings A Minor 111 bpm.alc'
OUT = os.environ.get('CHASE_OUT', f'{HERE}/Chase Strings Project/Chase Strings.als')
DEVICES = f'{HERE}/devices'

# ---------------------------------------------------------------- the score (as in sound.ts)
BARS = [
    dict(root=37, tune=[(73, 4), (76, 4), (80, 6), (81, 2)], high=80, bells=[85, 88, 92, 97, 88, 92, 97, 100]),
    dict(root=33, tune=[(80, 4), (76, 4), (73, 8)], high=88, bells=[85, 88, 93, 97, 88, 93, 97, 100]),
    dict(root=42, tune=[(78, 4), (81, 4), (85, 6), (84, 2)], high=85, bells=[85, 90, 93, 97, 90, 93, 97, 99]),
    dict(root=44, tune=[(80, 8), (84, 4), (80, 4)], high=87, bells=[87, 92, 96, 99, 84, 87, 92, 96]),
    dict(root=37, tune=[(73, 4), (76, 4), (80, 6), (81, 2)], high=80, bells=[85, 88, 92, 97, 88, 92, 97, 100]),
    dict(root=33, tune=[(81, 4), (80, 4), (76, 4), (73, 4)], high=88, bells=[85, 88, 92, 97, 88, 93, 97, 100]),
    dict(root=38, tune=[(74, 4), (78, 4), (81, 6), (80, 2)], high=81, bells=[81, 86, 90, 93, 86, 90, 93, 97]),
    dict(root=44, tune=[(80, 4), (75, 4), (72, 8)], high=87, bells=[87, 92, 96, 99, 84, 87, 92, 96]),
]
OSTINATO = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 0, 7]
ACCENT = {0, 3, 6, 8, 11, 14}
S = 0.25  # a sixteenth, in beats


def bar_notes(part, index):
    """One bar of one part: (beat within the bar, length in beats, pitch, velocity)."""
    bar = BARS[index]
    out = []
    if part == 'short':
        out = [(i * S, 0.2, bar['root'] + 12 + OSTINATO[i], 112 if i in ACCENT else 84) for i in range(16)]
    elif part == 'short8':
        out = [(i * S, 0.18, bar['root'] + 24 + OSTINATO[i], 72) for i in range(16)]
    elif part == 'cellos':
        out = [(0, 1.9, bar['root'], 100), (2, 1.9, bar['root'], 94)]
    elif part == 'bed':
        out = [(0, 3.95, bar['root'] + 12, 72), (0, 3.95, bar['root'] + 19, 64)]
    elif part == 'cellobite':
        out = [(0, 0.3, bar['root'], 104), (2, 0.3, bar['root'], 96)]
    elif part in ('violin', 'violinbite'):
        at = 0
        for pitch, length in bar['tune']:
            out.append((at * S, 0.3 if part == 'violinbite' else length * S * 0.97, pitch, 104))
            at += length
    elif part == 'high':
        out = [(0, 3.8, bar['high'], 76)]
    elif part == 'kick':
        out = [(0, 0.5, 60, 112), (2, 0.5, 60, 106)]
    elif part == 'kickpush':
        out = [(2.5, 0.4, 60, 112)]
    elif part == 'snare':
        out = [(1, 0.4, 60, 104), (3, 0.4, 60, 104)]
    elif part == 'hats8':
        out = [(i * 0.5, 0.1, 60, 100 if i % 2 else 66) for i in range(8)]
    elif part == 'hats16':
        out = [(i * 0.5 + S, 0.1, 60, 66) for i in range(8)]
    elif part == 'toms':
        out = [(3 + i * S, 0.24, pitch, 104) for i, pitch in enumerate([63, 61, 59, 57])] if index == 7 else []
    elif part == 'bells':
        out = [(i * 0.5, 0.3, pitch, 100) for i, pitch in enumerate(bar['bells'])]
    return out


def loop(part):
    return [(b * 4 + t, d, p, v) for b in range(8) for t, d, p, v in bar_notes(part, b)]


def dash(part):
    return bar_notes(part, 7)


# The sound on each track: Splice INSTRUMENT set to one of the LABS Strings presets, a rack preset
# from Live's Core Library (its own chain of devices), or one drum hit from a Core Library kit.
# "Short" with its Tightness knob all the way up (the knob is the plug-in's eighth general parameter).
SHORT = ('splice', 'labs-strings-short.state', {'i_tight': '1.0', 'g_general_param_8': '1.0'})
LONG = ('splice', 'labs-strings-long.state')
CELESTE = ('rack', 'Racks/Instrument Racks/Mallets/Celeste.adg')
KIT = 'Racks/Drum Racks/Acoustic/Tamuz Kit.adg'


def hit(sample):
    return ('hit', KIT, sample)


# Effects after the sound, each one of Live's own presets with a few of its settings changed.
HALL = ('Devices/Audio Effects/Reverb/Hall/Concert Hall.adv', {'MixDirect': 0.16})  # (MixDirect is the Dry/Wet knob)
HALL_LOW = ('Devices/Audio Effects/Reverb/Hall/Concert Hall.adv', {'MixDirect': 0.08})
HALL_BIG = ('Devices/Audio Effects/Reverb/Hall/Concert Hall.adv', {'MixDirect': 0.3})
# the high strings shake on their note: the bow going back and forth, about eleven times a second
SHAKE = ('Devices/Audio Effects/Auto Pan-Tremolo/Trem Fast Vibrations.adv', {'Modulation_Amount': 0.6, 'Modulation_Frequency': 11, 'DynamicFrequencyModulation': 0, 'TremoloWaveformShape': 0})

# Where things are, in beats. A bar is four.
LOOPS = [0, 32, 64]
DASH, LAND = 92, 96
LONG_AT, LONG_LEN = 128, 16
END = 144

# How late the two string sounds speak, measured from single notes exported from Live (2026-11-19):
# a "Short" note is at its loudest about 110 thousandths of a second after it is played, whatever
# the Tightness, and the middle of its rise comes at about 70. A "Long" note swells in over half a
# second. So the short tracks are pulled early by Live's track delay, the long ones by a little,
# and the parts that need both a clear start and a body (the tune, the cellos, the landing chord)
# have a short track laid over a long one.
#
# Whether 70 is right for the short strings is open. It puts the middle of a note's rise on the
# beat; its loudest moment is then 35 ms late, but the bright part of its attack (what a phone's
# speaker plays) is on the beat to within 5 ms. Drew heard the amber's bells as out of time with
# the strings in build 64, mostly in play, where the cause was more likely the tape's slack against
# the runner (see sound.ts, withTape). He has clips at 70, 95 and 120 to choose from by ear.
#
# Live plays the track delays but its export of single tracks leaves them out (measured: the files
# of a delayed and an undelayed version line up exactly). cut_layers.py reads these same numbers
# and moves each file by its track's delay, so the game's layers match what Live plays.
SHORT_DELAY = -70
LONG_DELAY = -60
BODY_DELAY = -120

# Each track: name, Live color index, mixer gain (1 is 0 dB), its sound, its effects, and its clips as (name, first beat, length in beats, notes).
# `delay` is Live's track delay in milliseconds, and `volume` a list of (beat, gain) for the mixer's volume to follow.
# The strings' gains are set by measurement, so that each is as loud against the others as it is in
# the game's synthesized band (which was matched to Drew's clip of the original). The drums were set
# the same way at first, and on a phone's speaker they could hardly be heard (Drew, build 64: "way
# too quiet"): a real drum needs far more level than a synthesized click to be heard there. They are
# now 4 to 14 dB up from that, by judgment, for Drew to check by ear. (The kick least: a phone can't
# play its weight, only its click, and its weight uses up room the rest needs.)
tracks = []
for name, part, color, gain, sound, fx, delay in [
    ('Short strings', 'short', 16, 0.326, SHORT, [], SHORT_DELAY), ('Short strings 8va', 'short8', 16, 0.115, SHORT, [], SHORT_DELAY),
    ('Cellos', 'cellos', 17, 0.95, LONG, [], BODY_DELAY), ('Cellos (the start of each note)', 'cellobite', 17, 0.37, SHORT, [], SHORT_DELAY),
    ('Held strings', 'bed', 17, 0.534, LONG, [], LONG_DELAY),
    ('Violin tune', 'violin', 18, 1.3, LONG, [], BODY_DELAY), ('Violin tune (the start of each note)', 'violinbite', 18, 0.3, SHORT, [], SHORT_DELAY),
    ('High strings', 'high', 18, 0.46, LONG, [SHAKE], LONG_DELAY),
    ('Kick', 'kick', 3, 0.63, hit('Kick Tamuz 1.wav'), [HALL_LOW], 0), ('Kick push', 'kickpush', 3, 0.63, hit('Kick Tamuz 1.wav'), [HALL_LOW], 0),
    ('Snare', 'snare', 4, 0.43, hit('Snare Tamuz 1.wav'), [HALL], 0),
    ('Hats eighths', 'hats8', 5, 0.5, hit('Hihat Closed Tamuz Tight.wav'), [HALL_LOW], 0), ('Hats sixteenths', 'hats16', 5, 0.5, hit('Hihat Closed Tamuz Tight.wav'), [HALL_LOW], 0),
    ('Toms', 'toms', 4, 0.42, hit('Tom Tamuz Mid 1.wav'), [HALL], 0),
    ('Bells (amber line)', 'bells', 26, 0.3, CELESTE, [], 0),
]:
    clips = [(label, at, 32, loop(part)) for label, at in zip(('Loop', 'Loop again (the game\'s layers are cut from here)', 'Loop, ending on the dash bar'), LOOPS)]
    tracks.append(dict(name=name, color=color, gain=gain, sound=sound, fx=fx, delay=delay, clips=clips))

# Drew tried two drum mixes in the game and picked the louder one (2026-11-19: "D sounded better on
# my computer, but "Loud" sounds much better on my phone"): the chase's drums 4 dB up again. It was a
# gain in the game; now it's the faders here, so Live plays what the game does.
LOUD = 1.58
for t in tracks:
    if t['name'] in ('Kick', 'Kick push', 'Snare', 'Hats eighths', 'Hats sixteenths', 'Toms'):
        t['gain'] *= LOUD


# the build over the dash bar, and the landing
def roll(beats):
    """A roll on the low tom, a stroke every 72 thousandths of a second, growing over the first bar."""
    count = int(beats / 0.144)
    return [(i * 0.144, 0.12, 60, int(40 + 80 * min(1, i / 27))) for i in range(count)]


def swell(beats):
    return [(0, beats, p, 96) for p in (44, 56, 60, 63, 68)]


SWELL_GAIN = 0.9
LANDING = [(0, 9.6, p, 70 if p == 77 else 110) for p in (37, 49, 56, 61, 65, 68, 73, 77)]
LANDING_GAIN = 1.12
# the landing chord holds for a second and a half and then dies away over three more, as the game's own does
RING = [(LAND, LANDING_GAIN), (LAND + 3.2, LANDING_GAIN)] + [(LAND + 3.2 + 0.4 * i, LANDING_GAIN * 0.012 ** (i / 16)) for i in range(1, 17)]
tracks += [
    dict(name='Ending swell', color=9, gain=SWELL_GAIN, sound=LONG, fx=[], delay=LONG_DELAY,
         clips=[('Swell', DASH, 4, swell(4)), ('For the game: the swell, long', LONG_AT, LONG_LEN, swell(LONG_LEN))],
         # it grows through its first bar
         volume=[(DASH, 0.14 * SWELL_GAIN), (LAND, SWELL_GAIN), (LONG_AT - 2, SWELL_GAIN), (LONG_AT - 1, 0.14 * SWELL_GAIN), (LONG_AT, 0.14 * SWELL_GAIN), (LONG_AT + 4, SWELL_GAIN)]),
    dict(name='Ending roll', color=9, gain=0.35, sound=hit('Tom Tamuz Low.wav'), fx=[HALL], delay=0,
         clips=[('Roll', DASH, 4, roll(4)), ('For the game: the roll, long', LONG_AT, LONG_LEN, roll(LONG_LEN))]),
    dict(name='Landing chord', color=9, gain=LANDING_GAIN, sound=LONG, fx=[], delay=BODY_DELAY, clips=[('Landing', LAND, 12, LANDING)], volume=RING),
    dict(name='Landing chord (the start)', color=9, gain=0.5, sound=SHORT, fx=[], delay=SHORT_DELAY, clips=[('Landing', LAND, 12, [(0, 0.5, p, v) for _, _, p, v in LANDING])]),
    dict(name='Landing drum', color=9, gain=0.8, sound=hit('Kick Tamuz 2.wav'), fx=[HALL_BIG], delay=0, clips=[('Landing', LAND, 12, [(0, 2, 60, 120)])]),
    dict(name='Landing cymbal', color=9, gain=1.99, sound=hit('Crash Tamuz 1.wav'), fx=[HALL], delay=0, clips=[('Landing', LAND, 12, [(0, 4, 60, 100)])]),
]

# Every fader 3 dB down, to keep Live's Main track clear of full scale at the landing, which is the
# loudest moment. (The game turns its layers back up by the same.)
TRIM = 0.708
for t in tracks:
    t['gain'] = round(t['gain'] * TRIM, 4)
    if t.get('volume'):
        t['volume'] = [(beat, value * TRIM) for beat, value in t['volume']]

# ---------------------------------------------------------------- the set
POINTEES = ('AutomationTarget', 'ModulationTarget', 'Pointee')


def is_pointee(tag):
    return tag in POINTEES or tag.startswith('ControllerTargets.') or tag.endswith('ModulationTarget')


_presets = {}


def preset(path):
    if path not in _presets:
        _presets[path] = ET.fromstring(gzip.open(f'{CORE}/{path}', 'rb').read())
    return _presets[path]


def splice_state(name, settings):
    """
    What Splice INSTRUMENT was set to, as Live keeps it, with some of its settings changed. Inside
    the wrapping it is plain XML: a list of ids and values (i_tight, i_reverb and the rest).
    """
    data = open(f'{DEVICES}/{name}', 'rb').read()
    if not settings:
        return data
    i = data.find(b'<?xml')
    j = data.find(b'</SpliceINSTRUMENT>') + len(b'</SpliceINSTRUMENT>')
    xml = data[i:j].decode()
    for key, value in settings.items():
        xml, count = re.subn(r'(id="%s" value=")[^"]*(")' % re.escape(key), r'\g<1>%s\g<2>' % value, xml)
        assert count == 1, key
    body = xml.encode()
    out = bytearray(data[:i] + body + data[j:])
    # three lengths in the wrapping have to agree with the new text
    struct.pack_into('>I', out, 20, len(out) - 24)
    struct.pack_into('>I', out, i - 12, len(out) - (i - 8))
    struct.pack_into('<I', out, i - 4, len(body))
    return bytes(out)


def splice_device(state, settings):
    """Splice INSTRUMENT, as Live saved it, set to what `state` holds (a preset of a LABS pack)."""
    device = ET.fromstring(gzip.open(f'{DEVICES}/splice-instrument.xml.gz', 'rb').read())
    data = splice_state(state, settings).hex().upper()
    device.find('.//ProcessorState').text = '\n' + '\n'.join(data[i:i + 80] for i in range(0, len(data), 80)) + '\n'
    return device


def effect(path, settings):
    """One of Live's effect presets, with some of its knobs set."""
    device = copy.deepcopy(list(preset(path))[0])
    for tag, value in settings.items():
        device.find(f'{tag}/Manual').set('Value', str(value))
    return device


def sound_devices(sound, fx):
    """The devices for a track: its sound, copied out of a preset, and its effects after."""
    if sound[0] == 'splice':
        found = [splice_device(sound[1], sound[2] if len(sound) > 2 else {})]
    elif sound[0] == 'rack':
        # a rack preset keeps its chain's devices one after another; the last is the chain's own mixer, which a track has no use for
        found = [copy.deepcopy(d) for holder in preset(sound[1]).iter('AbletonDevicePreset') for d in holder.find('Device')]
        # (nor for the echo some presets add, which would smear a part in sixteenths)
        found = [d for d in found if 'BranchMixer' not in d.tag and d.tag != 'Delay']
    else:
        found = []
        for cell in preset(sound[1]).iter('DrumCell'):
            if any(e.get('Value', '').endswith('/' + sound[2]) for e in cell.iter('Path')):
                found = [copy.deepcopy(cell)]
                break
        assert found, sound
    found += [effect(path, settings) for path, settings in fx]
    for k, device in enumerate(found):
        device.set('Id', str(k))
        # (what tied a knob to the rack's macro controls means nothing outside the rack)
        for parent in device.iter():
            for child in list(parent):
                if child.tag == 'KeyMidi':
                    parent.remove(child)
    return found


def envelope(target, points):
    """Automation for one control: `points` are (beat, value), and before the first the value is the first's."""
    env = ET.Element('AutomationEnvelope', Id='0')
    ET.SubElement(ET.SubElement(env, 'EnvelopeTarget'), 'PointeeId', Value=str(target))
    automation = ET.SubElement(env, 'Automation')
    events = ET.SubElement(automation, 'Events')
    for k, (time, value) in enumerate([(-63072000, points[0][1])] + list(points)):
        ET.SubElement(events, 'FloatEvent', Id=str(k + 1), Time=f'{time:.6g}' if k else str(time), Value=f'{value:.6g}')
    state = ET.SubElement(automation, 'AutomationTransformViewState')
    ET.SubElement(state, 'IsTransformPending', Value='false')
    ET.SubElement(state, 'TimeAndValueTransforms')
    return env


def make_clip(template, index, name, start, length, notes, color):
    clip = copy.deepcopy(template)
    clip.set('Id', str(index))
    clip.set('Time', str(start))
    clip.find('CurrentStart').set('Value', str(start))
    clip.find('CurrentEnd').set('Value', str(start + length))
    for tag, value in [('LoopStart', 0), ('LoopEnd', length), ('StartRelative', 0), ('OutMarker', length), ('HiddenLoopStart', 0), ('HiddenLoopEnd', length)]:
        clip.find(f'Loop/{tag}').set('Value', str(value))
    clip.find('Loop/LoopOn').set('Value', 'false')
    clip.find('Name').set('Value', name)
    clip.find('Color').set('Value', str(color))
    clip.find('ScrollerTimePreserver/LeftTime').set('Value', '0')
    clip.find('ScrollerTimePreserver/RightTime').set('Value', str(length))
    keytracks = clip.find('Notes/KeyTracks')
    sample = copy.deepcopy(keytracks.find('KeyTrack'))
    event = dict(sample.find('Notes/MidiNoteEvent').attrib)
    for child in list(keytracks):
        keytracks.remove(child)
    note_id = 1
    for k, pitch in enumerate(sorted({p for _, _, p, _ in notes}, reverse=True)):
        kt = copy.deepcopy(sample)
        kt.set('Id', str(k))
        holder = kt.find('Notes')
        for child in list(holder):
            holder.remove(child)
        for t, d, p, v in sorted(notes):
            if p != pitch:
                continue
            e = ET.SubElement(holder, 'MidiNoteEvent', dict(event, Time=f'{t:.6g}', Duration=f'{d:.6g}', Velocity=str(v), NoteId=str(note_id)))
            e.tail = '\n'
            note_id += 1
        kt.find('MidiKey').set('Value', str(pitch))
        keytracks.append(kt)
    for store in ('PerNoteEventStore', 'NoteProbabilityGroups'):
        el = clip.find(f'Notes/{store}')
        for sub in list(el):
            for child in list(sub):
                sub.remove(child)
    clip.find('Notes/NoteIdGenerator/NextId').set('Value', str(note_id))
    return clip


def main():
    root = ET.fromstring(gzip.open(TEMPLATE, 'rb').read())
    live = root.find('LiveSet')
    holder = live.find('Tracks')
    template_track = holder.find('MidiTrack')
    template_clip = copy.deepcopy(next(template_track.iter('MidiClip')))
    holder.remove(template_track)
    # an empty track: no clip in its session slot, no device
    slot_value = template_track.find('DeviceChain/MainSequencer/ClipSlotList/ClipSlot/ClipSlot/Value')
    for child in list(slot_value):
        slot_value.remove(child)
    devices = template_track.find('DeviceChain/DeviceChain/Devices')
    for child in list(devices):
        devices.remove(child)

    next_pointee = max(int(e.get('Id')) for e in live.iter() if e.get('Id') and is_pointee(e.tag)) + 100
    for index, t in enumerate(tracks):
        name, color = t['name'], t['color']
        track = copy.deepcopy(template_track)
        track.set('Id', str(index + 20))
        track.find('Name/EffectiveName').set('Value', name)
        track.find('Name/UserName').set('Value', name)
        track.find('Color').set('Value', str(color))
        track.find('DeviceChain/Mixer/Volume/Manual').set('Value', str(t['gain']))
        track.find('TrackDelay/Value').set('Value', str(t['delay']))
        holder_devices = track.find('DeviceChain/DeviceChain/Devices')
        for device in sound_devices(t['sound'], t['fx']):
            holder_devices.append(device)
        events = track.find('DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events')
        for k, (clip_name, start, length, notes) in enumerate(t['clips']):
            if notes:
                events.append(make_clip(template_clip, k, clip_name, start, length, notes, color))
        # every automatable thing in a set has a number of its own
        for el in track.iter():
            if el.get('Id') and is_pointee(el.tag):
                el.set('Id', str(next_pointee))
                next_pointee += 1
        if t.get('volume'):
            target = track.find('DeviceChain/Mixer/Volume/AutomationTarget').get('Id')
            track.find('AutomationEnvelopes/Envelopes').append(envelope(target, t['volume']))
        holder.append(track)
    live.find('NextPointeeId').set('Value', str(next_pointee + 1))

    # 120 beats a minute, and the loop brace round the eight bars
    main_track = live.find('MainTrack')
    main_track.find('.//Tempo/Manual').set('Value', '120')
    for e in main_track.iter('FloatEvent'):
        if e.get('Value') == '111':
            e.set('Value', '120')
    transport = live.find('Transport')
    transport.find('LoopOn').set('Value', 'true')
    transport.find('LoopStart').set('Value', '0')
    transport.find('LoopLength').set('Value', '32')

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    xml = b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding='utf-8')
    with gzip.open(OUT, 'wb') as fh:
        fh.write(xml)
    notes = sum(len(n) for t in tracks for _, _, _, n in t['clips'])
    print(f'{OUT}\n{len(tracks)} tracks, {notes} notes, {len(xml) // 1024} KB of XML')


if __name__ == '__main__':
    main()
