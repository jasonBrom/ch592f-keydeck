#include <assert.h>
#include <stdio.h>
#include "relative_report.h"
int main(void){
    uint8_t a[4]={1,180,0,0},b[4]={1,180,0,0};
    assert(c5_relative_merge(3,a,b,3)&&a[1]==104&&a[2]==1);
    b[0]=0;assert(!c5_relative_merge(3,a,b,3));b[0]=1;b[1]=b[2]=0;assert(!c5_relative_merge(3,a,b,3));
    b[1]=0x4c;b[2]=0xff;assert(!c5_relative_merge(3,a,b,3));a[1]=b[1];a[2]=b[2];
    assert(c5_relative_merge(3,a,b,3)&&a[1]==0x98&&a[2]==0xfe);
    a[1]=0x10;a[2]=0x0e;b[1]=1;b[2]=0;assert(!c5_relative_merge(3,a,b,3));
    a[0]=b[0]=3;a[1]=a[2]=b[1]=b[2]=0;a[3]=100;b[3]=27;
    assert(c5_relative_merge(4,a,b,4)&&a[3]==127);b[3]=1;assert(!c5_relative_merge(4,a,b,4));
    b[3]=255;assert(!c5_relative_merge(4,a,b,4));a[3]=255;assert(c5_relative_merge(4,a,b,4)&&a[3]==254);
    b[1]=1;assert(!c5_relative_merge(4,a,b,4));assert(!c5_relative_merge(1,a,b,4));
    puts("relative reports: exact sums, HID limits, direction/button/neutral boundaries and absolute reports passed");
}
