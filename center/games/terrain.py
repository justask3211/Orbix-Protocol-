"""Versioned field topography shared mathematically with the browser mesh.

No asset or client coordinate owns collision height. Preserve this function for
saved field-v1 rooms; introduce a new descriptor before changing its formula.
"""
import math


def smooth(a,b,value):
    t=max(0.,min(1.,(value-a)/(b-a)))
    return t*t*(3-2*t)


def terrain_height(x,z,theme='island'):
    radius=math.hypot(x,z)
    fade=smooth(5,11,radius)
    if theme=='courtyard':
        return fade*(.16+.12*math.sin(x*.18)*math.sin(z*.16))
    ripple=.16*(1+math.sin(x*.23+.4)*math.sin(z*.19))
    if theme=='guardian':
        rim=1.05*math.exp(-((radius-16)/5)**2)
        return fade*(ripple+rim)
    hill=1.45*math.exp(-((x+12)**2+(z-10)**2)/42)
    hill+=1.1*math.exp(-((x-13)**2+(z+11)**2)/36)
    return fade*(ripple+hill+.38*smooth(16,25,radius))
